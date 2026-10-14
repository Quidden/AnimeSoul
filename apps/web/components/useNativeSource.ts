"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type Hls from "hls.js";
import type { Stream } from "@animesoul/contracts";
import { reportClientError } from "../lib/diagnostics-client";
type Source = Extract<Stream, { mode: "direct" }>["sources"][number];
// Prepare a replacement decoder without interrupting the current one. Only the
// latest request may commit; cancelling a request never unloads the active video.
export function useNativeSource({
  source,
  video,
  position,
  shouldPlay,
  onReady,
  onFailure,
  onFallback,
  onRefresh,
}: {
  source: Source | undefined;
  video: RefObject<HTMLVideoElement | null>;
  position: RefObject<number>;
  shouldPlay: RefObject<boolean>;
  onReady: (element: HTMLVideoElement) => void;
  onFailure: (quality: number | undefined) => void;
  onFallback: () => void;
  onRefresh: () => Promise<boolean>;
}) {
  const elements = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const active = useRef<{ slot: number; source: Source; dispose: () => void } | null>(null);
  const handlers = useRef({ onReady, onFailure, onFallback, onRefresh });
  handlers.current = { onReady, onFailure, onFallback, onRefresh };
  const [slot, setSlot] = useState(0),
    [sourceKey, setSourceKey] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    if (!source || active.current?.source.src === source.src) {
      setPending(false);
      return;
    }
    const nextSlot = active.current ? 1 - active.current.slot : 0;
    const candidate = elements.current[nextSlot];
    if (!candidate) return;
    let cancelled = false,
      committed = false,
      hls: Hls | undefined,
      recovering = false;
    setPending(true);
    const dispose = () => {
      cancelled = true;
      clearTimeout(timeout);
      candidate.removeEventListener("loadedmetadata", metadata);
      candidate.removeEventListener("canplay", commit);
      candidate.removeEventListener("seeked", commit);
      candidate.removeEventListener("error", error);
      hls?.destroy();
      candidate.pause();
      candidate.removeAttribute("src");
      candidate.load();
    };
    const fail = () => {
      if (cancelled) return;
      reportClientError(
        new Error(
          `Video source failed (media code ${candidate.error?.code ?? 0}, quality ${source.quality})`,
        ),
        "player",
      );
      cancelled = true;
      if (committed) handlers.current.onFallback();
      else {
        dispose();
        setPending(false);
        if (active.current) handlers.current.onFailure(active.current.source.quality);
        else handlers.current.onFallback();
      }
    };
    const error = () => {
      if (!hls) fail();
    };
    const metadata = () => {
      if (cancelled || committed) return;
      const current = active.current ? video.current : null;
      const target = current?.readyState ? current.currentTime : position.current;
      candidate.currentTime = Math.min(
        target,
        Number.isFinite(candidate.duration) ? Math.max(0, candidate.duration - 0.1) : target,
      );
    };
    const commit = () => {
      if (cancelled || committed || candidate.readyState < 3 || candidate.seeking) return;
      const previous = active.current;
      const old = previous ? video.current : null;
      if (old && Math.abs(candidate.currentTime - old.currentTime) > 0.7) {
        metadata();
        return;
      }
      clearTimeout(timeout);
      candidate.volume = old?.volume ?? 1;
      candidate.muted = old?.muted ?? false;
      candidate.playbackRate = old?.playbackRate ?? 1;
      const play = old ? !old.paused && !old.ended : shouldPlay.current;
      committed = true;
      active.current = { slot: nextSlot, source, dispose };
      video.current = candidate;
      position.current = candidate.currentTime;
      shouldPlay.current = play;
      setSlot(nextSlot);
      setSourceKey(source.src);
      setPending(false);
      handlers.current.onReady(candidate);
      if (play) void candidate.play().catch(() => handlers.current.onReady(candidate));
      previous?.dispose();
    };
    candidate.muted = true;
    candidate.addEventListener("loadedmetadata", metadata);
    candidate.addEventListener("canplay", commit);
    candidate.addEventListener("seeked", commit);
    candidate.addEventListener("error", error);
    const timeout = setTimeout(fail, 20000);
    async function attach() {
      try {
        if (source!.type === "hls") {
          const { default: Runtime } = await import("hls.js");
          if (cancelled) return;
          if (Runtime.isSupported()) {
            hls = new Runtime({
              enableWorker: true,
              maxBufferLength: 12,
              backBufferLength: 12,
              startPosition: video.current?.currentTime ?? position.current,
            });
            hls.on(Runtime.Events.ERROR, (_event, data) => {
              if (cancelled || !data.fatal) return;
              if (data.type === Runtime.ErrorTypes.MEDIA_ERROR && !recovering) {
                recovering = true;
                hls?.recoverMediaError();
              } else if (
                committed &&
                data.type === Runtime.ErrorTypes.NETWORK_ERROR &&
                !recovering
              ) {
                recovering = true;
                void handlers.current
                  .onRefresh()
                  .then((ok) => {
                    if (!cancelled && !ok) fail();
                  })
                  .catch(fail);
              } else fail();
            });
            hls.loadSource(source!.src);
            hls.attachMedia(candidate!);
            return;
          }
          if (!candidate!.canPlayType("application/vnd.apple.mpegurl")) {
            fail();
            return;
          }
        }
        candidate!.src = source!.src;
        candidate!.load();
      } catch {
        fail();
      }
    }
    // A short coalescing window avoids starting network/decoder work for every
    // intermediate selection during rapid quality changes.
    const debounce = setTimeout(() => void attach(), active.current ? 100 : 0);
    return () => {
      clearTimeout(debounce);
      if (!committed) {
        cancelled = true;
        dispose();
      }
    };
  }, [source?.src, source?.type, video, position, shouldPlay]);
  useEffect(
    () => () => {
      active.current?.dispose();
      active.current = null;
    },
    [],
  );
  return { elements, slot, sourceKey, pending };
}
