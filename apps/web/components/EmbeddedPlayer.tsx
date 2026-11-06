"use client";
import { useEffect, useRef, useState } from "react";
import { embeddedPlayerEvent } from "@animesoul/contracts";
import { kodikResume } from "../lib/kodik-resume";
import { PlayerLoadingHint, type ProgressStatus } from "./PlayerLoadingHint";
export function EmbeddedPlayer({
  url,
  title,
  start,
  onTime,
  onEpisode,
  paused = false,
  autoplay = false,
  progressStatus = "guest",
}: {
  url: string;
  title: string;
  start: number;
  paused?: boolean;
  autoplay?: boolean;
  progressStatus?: ProgressStatus;
  onTime: (position: number, duration: number, playing: boolean, ended?: boolean) => void;
  onEpisode: (number: string, season?: string, translation?: string) => boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    callback = useRef(onTime),
    episodeCallback = useRef(onEpisode),
    pauseState = useRef(paused);
  const seekNow = useRef<(() => void) | null>(null);
  const autoplayState = useRef(autoplay);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  callback.current = onTime;
  episodeCallback.current = onEpisode;
  pauseState.current = paused;
  // Receiving play events must not reload the iframe by changing autoplay.
  const initialAutoplay = useRef(autoplay);
  const address = new URL(url);
  address.searchParams.set("autoplay", initialAutoplay.current ? "1" : "0");
  function command(method: string, seconds?: number) {
    frame.current?.contentWindow?.postMessage(
      { key: "kodik_player_api", value: { method, ...(seconds === undefined ? {} : { seconds }) } },
      new URL(url).origin,
    );
  }
  useEffect(() => {
    if (paused) command("pause");
  }, [paused, url]);
  useEffect(() => {
    const requested = autoplay && !autoplayState.current;
    autoplayState.current = autoplay;
    if (requested && !pauseState.current) {
      seekNow.current?.();
      command("play");
    }
  }, [autoplay]);
  useEffect(() => {
    setNotice("");
    setLoading(true);
    let position = 0,
      duration = 0,
      playing = false,
      blocked = false,
      observed = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const resume = kodikResume(start);
    const seek = () => {
      const target = resume.seek(Date.now());
      if (target !== null) command("seek", target);
    };
    seekNow.current = seek;
    function message(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const value = embeddedPlayerEvent(event.data, event.origin, url);
      if (!value) return;
      if (value.kind === "episode") {
        blocked = !episodeCallback.current(value.number, value.season, value.translation);
        return;
      }
      if (blocked) return;
      if (value.kind === "ready") {
        setLoading(false);
        seek();
        if (pauseState.current) command("pause");
        else if (autoplayState.current) command("play");
        return;
      }
      if (value.kind === "duration") {
        setLoading(false);
        duration = value.duration;
        resume.duration(duration);
        seek();
        return;
      }
      if (value.kind === "time" || value.kind === "seek") {
        setLoading(false);
        if (value.kind === "time" && value.duration) {
          duration = value.duration;
          resume.duration(duration);
        }
        seek();
        const state = resume.observe(value.position, Date.now());
        if (state === "waiting") return;
        if (state === "failed")
          setNotice(
            "Не удалось восстановить момент автоматически. Можно повторить или перемотать в плеере.",
          );
        observed = true;
        if (value.kind === "time" && value.position > position && value.position - position < 5)
          playing = true;
        position = value.position;
        if (pauseState.current) {
          playing = false;
          command("pause");
        }
        clearTimeout(idle);
        idle = setTimeout(() => {
          playing = false;
          callback.current(position, duration, false);
        }, 2500);
      }
      if (value.kind === "play") {
        setLoading(false);
        playing = !pauseState.current;
        seek();
        if (pauseState.current) command("pause");
      }
      if (value.kind === "pause" || value.kind === "ended") playing = false;
      if (value.kind === "pause") command("get_time");
      if (value.kind === "ended" && duration > 0) {
        position = duration;
        observed = true;
      }
      if (!observed) return;
      callback.current(position, duration, playing, value.kind === "ended");
    }
    const repeat = setInterval(seek, 1500);
    window.addEventListener("message", message);
    return () => {
      seekNow.current = null;
      clearInterval(repeat);
      clearTimeout(idle);
      window.removeEventListener("message", message);
    };
  }, [url, start, retry]);
  return (
    <>
      <iframe
        ref={frame}
        src={address.href}
        title={title}
        onLoad={() => seekNow.current?.()}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="origin"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
      />
      <PlayerLoadingHint loading={loading} progressStatus={progressStatus} />
      {notice && (
        <div className="embedded-resume-notice" role="status">
          {notice}{" "}
          <button className="outline" onClick={() => setRetry((value) => value + 1)}>
            Восстановить момент
          </button>
        </div>
      )}
    </>
  );
}
