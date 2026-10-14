"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { savedPlaybackSchema, type Account } from "@animesoul/contracts";
import { loadAccount } from "../lib/account-client";
type Saved = z.infer<typeof savedPlaybackSchema>["progress"];
async function write(
  path: string,
  body: unknown,
  csrf: string,
  signal?: AbortSignal,
  keepalive = false,
) {
  const response = await fetch("/api/account/playback/" + path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive,
    headers: {
      "Content-Type": "application/json",
      "X-AnimeSoul-Request": "1",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Progress unavailable");
  return response.json() as Promise<unknown>;
}
export function usePlaybackProgress(
  animeId: string | undefined,
  episodeId: string | undefined,
  started: boolean,
  dubbing: string,
) {
  const [account, setAccount] = useState<Account | null>(null);
  const [saved, setSaved] = useState<Saved>([]);
  const [status, setStatus] = useState<"guest" | "loading" | "saved" | "error">("loading");
  const activity = useRef({
    position: 0,
    duration: 0,
    playing: false,
    completed: false,
    watched: 0,
    observed: false,
  });
  const reporting = useRef<((keepalive?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    let current = true,
      generation = 0;
    async function refresh() {
      const attempt = ++generation;
      setAccount(null);
      setSaved([]);
      setStatus("loading");
      let authenticated = false;
      try {
        const result = await loadAccount();
        if (!current || attempt !== generation) return;
        setAccount(result);
        authenticated = true;
        if (animeId) {
          const response = await fetch("/api/account/playback/" + animeId, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (!response.ok) throw new Error();
          const value = savedPlaybackSchema.parse(await response.json());
          if (!current || attempt !== generation) return;
          setSaved(value.progress);
        }
        setStatus("saved");
      } catch {
        if (current && attempt === generation) setStatus(authenticated ? "error" : "guest");
      }
    }
    void refresh();
    window.addEventListener("animesoul:account-changed", refresh);
    return () => {
      current = false;
      generation++;
      window.removeEventListener("animesoul:account-changed", refresh);
    };
  }, [animeId]);
  useEffect(() => {
    activity.current = {
      position: 0,
      duration: 0,
      playing: false,
      completed: false,
      watched: 0,
      observed: false,
    };
    if (!started || !episodeId || !account) return;
    const controller = new AbortController();
    const currentActivity = activity.current;
    let closed = false;
    let sessionId = "",
      sequence = 0,
      pending = false,
      starting = false;
    const csrf = account.csrfToken;
    async function report(keepalive = false) {
      if (!sessionId || (pending && !keepalive) || !currentActivity.observed) return;
      const value = { ...currentActivity };
      // Reserve this delta before sending; a final newer sequence may overlap
      // an ordinary request without counting the same watched seconds twice.
      currentActivity.watched = Math.max(0, currentActivity.watched - value.watched);
      if (!keepalive) pending = true;
      try {
        await write(
          "progress",
          {
            sessionId,
            sequence: ++sequence,
            position: value.position,
            duration: value.duration,
            completed: value.completed,
            watchedDelta: Math.min(30, value.watched),
            dubbing,
          },
          csrf,
          keepalive ? undefined : controller.signal,
          keepalive,
        );
        if (!closed) setStatus("saved");
        window.dispatchEvent(new Event("animesoul:library-updated"));
      } catch {
        if (!closed) {
          currentActivity.watched = Math.min(30, currentActivity.watched + value.watched);
          setStatus("error");
        }
      } finally {
        if (!keepalive) pending = false;
      }
    }
    reporting.current = report;
    async function begin() {
      if (starting || sessionId || controller.signal.aborted) return;
      starting = true;
      try {
        const value = await write("session", { episodeId }, csrf, controller.signal, true);
        if (!controller.signal.aborted) {
          sessionId = z.object({ sessionId: z.uuid() }).parse(value).sessionId;
          if (closed) void report(true);
          else {
            setStatus("saved");
            void report();
          }
        }
      } catch {
        if (!controller.signal.aborted && !closed) setStatus("error");
      } finally {
        starting = false;
      }
    }
    void begin();
    let previous = performance.now(),
      ticks = 0;
    const timer = setInterval(() => {
      const now = performance.now(),
        delta = Math.min(2, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (currentActivity.playing)
        currentActivity.watched = Math.min(30, currentActivity.watched + delta);
      if (++ticks % 10 === 0) {
        if (!sessionId) void begin();
        else void report();
      }
    }, 1000);
    const leaving = () => void report(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") leaving();
    };
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      closed = true;
      void report(true);
      reporting.current = null;
      // Keep an observed start request alive so it can flush after navigation.
      // Unobserved Strict Mode replays must never create a stale active session.
      if (!currentActivity.observed) controller.abort();
      clearInterval(timer);
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [started, episodeId, account, dubbing]);
  function update(position: number, duration: number, playing: boolean, completed = false) {
    if (
      !Number.isFinite(position) ||
      position < 0 ||
      position > 86400 ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 86400
    )
      return;
    const previous = activity.current;
    const wasPlaying = previous.playing;
    Object.assign(previous, {
      observed: true,
      position: duration > 0 ? Math.min(position, duration) : position,
      duration,
      playing,
      completed: completed && duration > 0 && position >= duration * 0.9,
    });
    if ((!playing && wasPlaying) || completed) void reporting.current?.();
  }
  function pause() {
    activity.current.playing = false;
    void reporting.current?.();
  }
  return { account, accountId: account?.id, saved, status, update, pause };
}
