"use client";
import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import type { Stream } from "@animesoul/contracts";
type Source = Extract<Stream, { mode: "direct" }>["sources"][number];
export function PlayerTimelinePreview({
  source,
  time,
  visible,
  suspended,
}: {
  source: Source | undefined;
  time: number;
  visible: boolean;
  suspended: boolean;
}) {
  const decoder = useRef<HTMLVideoElement>(null),
    cache = useRef(new Map<number, string>());
  const target = Math.floor(time / 2) * 2;
  const current = useRef({ target, visible, suspended });
  current.current = { target, visible, suspended };
  const seek = useRef<() => void>(() => {});
  const [frame, setFrame] = useState<{ time: number; src: string; image: string } | null>(null),
    [failed, setFailed] = useState(false);
  const src = source?.src ?? "",
    type = source?.type;
  useEffect(() => {
    cache.current.clear();
    setFrame(null);
    setFailed(false);
  }, [src]);
  useEffect(() => {
    const video = decoder.current;
    if (!video || !src) return;
    let live = true,
      busy = false,
      capturing = -1,
      hls: Hls | undefined,
      timeout: ReturnType<typeof setTimeout> | undefined,
      blocked = false;
    const fail = () => {
      if (live) {
        blocked = true;
        busy = false;
        hls?.stopLoad();
        setFailed(true);
      }
    };
    const capture = () => {
      if (
        !live ||
        video.readyState < 2 ||
        video.seeking ||
        capturing < 0 ||
        !busy ||
        Math.abs(video.currentTime - capturing) > 1
      )
        return;
      clearTimeout(timeout);
      try {
        const surface = document.createElement("canvas"),
          scale = Math.min(192 / video.videoWidth, 108 / video.videoHeight);
        surface.width = Math.max(1, Math.round(video.videoWidth * scale));
        surface.height = Math.max(1, Math.round(video.videoHeight * scale));
        surface.getContext("2d")?.drawImage(video, 0, 0, surface.width, surface.height);
        const image = surface.toDataURL("image/jpeg", 0.55);
        cache.current.set(capturing, image);
        while (cache.current.size > 120) cache.current.delete(cache.current.keys().next().value!);
        if (current.current.target === capturing) setFrame({ time: capturing, src, image });
        setFailed(false);
      } catch {
        fail();
      }
      busy = false;
      hls?.stopLoad();
      if (!blocked && current.current.target !== capturing) seek.current();
    };
    seek.current = () => {
      if (!live || !current.current.visible || current.current.suspended) {
        clearTimeout(timeout);
        busy = false;
        capturing = -1;
        hls?.stopLoad();
        return;
      }
      blocked = false;
      const cached = cache.current.get(current.current.target);
      if (cached) {
        clearTimeout(timeout);
        busy = false;
        capturing = -1;
        hls?.stopLoad();
        setFrame({ time: current.current.target, src, image: cached });
        return;
      }
      if (busy && capturing === current.current.target) return;
      clearTimeout(timeout);
      hls?.stopLoad();
      capturing = current.current.target;
      busy = true;
      const next = Math.min(
        capturing,
        Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.1) : capturing,
      );
      hls?.startLoad(next);
      timeout = setTimeout(fail, 5000);
      if (video.readyState < 1) return;
      if (Math.abs(video.currentTime - next) < 0.05 && video.readyState >= 2) capture();
      else video.currentTime = next;
    };
    const metadata = () => {
      busy = false;
      seek.current();
    };
    const loaded = () => {
      if (busy) capture();
      else seek.current();
    };
    video.addEventListener("seeked", capture);
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("loadedmetadata", metadata);
    video.addEventListener("error", fail);
    async function attach() {
      if (!video) return;
      try {
        if (type === "hls") {
          const { default: Runtime } = await import("hls.js");
          if (!live) return;
          if (Runtime.isSupported()) {
            hls = new Runtime({
              autoStartLoad: false,
              enableWorker: true,
              backBufferLength: 30,
              maxBufferLength: 4,
              maxMaxBufferLength: 6,
              maxBufferSize: 3 * 1024 * 1024,
            });
            hls.on(Runtime.Events.MANIFEST_PARSED, () => {
              if (!live || !hls) return;
              const low = hls.levels.reduce(
                (best, level, index, levels) =>
                  (level.height || level.bitrate) < (levels[best]!.height || levels[best]!.bitrate)
                    ? index
                    : best,
                0,
              );
              hls.currentLevel = low;
              hls.nextLevel = low;
              hls.loadLevel = low;
              hls.autoLevelCapping = low;
              if (current.current.visible && !current.current.suspended)
                hls.startLoad(current.current.target);
            });
            hls.on(Runtime.Events.ERROR, (_event, data) => {
              if (data.fatal) fail();
            });
            hls.loadSource(src);
            hls.attachMedia(video);
            return;
          }
        }
        video.src = src;
        video.load();
      } catch {
        fail();
      }
    }
    void attach();
    return () => {
      live = false;
      clearTimeout(timeout);
      seek.current = () => {};
      video.removeEventListener("seeked", capture);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("loadedmetadata", metadata);
      video.removeEventListener("error", fail);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, type]);
  useEffect(() => {
    if (!visible || suspended) {
      seek.current();
      return;
    }
    const image = cache.current.get(target);
    if (image) {
      seek.current();
      return;
    }
    const timer = setTimeout(() => seek.current(), 45);
    return () => clearTimeout(timer);
  }, [target, visible, suspended, src]);
  const image = frame?.time === target && frame.src === src ? frame.image : "";
  return (
    <div
      className={`animesoul-player-timeline-preview${visible ? " visible" : ""}${image ? " ready" : " seeking"}`}
      aria-hidden="true"
      data-preview-time={target}
      data-preview-state={image ? "ready" : "loading"}
    >
      <div className="animesoul-player-timeline-preview-frame">
        <video ref={decoder} muted playsInline preload="metadata" crossOrigin="anonymous" hidden />
        {image ? (
          <img src={image} alt="" />
        ) : (
          <span>
            {suspended ? "Буферизация видео…" : failed ? "Кадр недоступен" : "Загружаем кадр…"}
          </span>
        )}
      </div>
      <time>
        {Math.floor(time / 60)}:{String(Math.floor(time % 60)).padStart(2, "0")}
      </time>
    </div>
  );
}
