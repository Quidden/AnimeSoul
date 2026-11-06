"use client";

import { useEffect, useRef, useState } from "react";
import { trailerEmbed } from "../lib/trailer";

type TrailerPlayer = {
  mute: () => void;
  unMute: () => void;
  destroy: () => void;
  getIframe: () => HTMLIFrameElement;
  getPlayerState: () => number;
};
type PlayerEvent = { target: TrailerPlayer; data: number };
type TrailerAPI = {
  Player: new (
    element: HTMLElement,
    options: {
      host: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: PlayerEvent) => void;
        onStateChange: (event: PlayerEvent) => void;
        onError: () => void;
        onAutoplayBlocked: () => void;
      };
    },
  ) => TrailerPlayer;
};
type TrailerWindow = Window & {
  YT?: TrailerAPI;
  onYouTubeIframeAPIReady?: (() => void) | undefined;
};
let trailerAPI: Promise<TrailerAPI> | undefined;

function loadTrailerAPI() {
  const target = window as TrailerWindow;
  if (target.YT?.Player) return Promise.resolve(target.YT);
  if (trailerAPI) return trailerAPI;
  trailerAPI = new Promise<TrailerAPI>((resolve, reject) => {
    const previous = target.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    const timeout = setTimeout(fail, 12000);
    function fail() {
      clearTimeout(timeout);
      target.onYouTubeIframeAPIReady = previous;
      script.remove();
      reject(new Error("Trailer preview unavailable"));
    }
    target.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      target.onYouTubeIframeAPIReady = previous;
      if (target.YT?.Player) resolve(target.YT);
      else reject(new Error("Trailer preview unavailable"));
      previous?.();
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    trailerAPI = undefined;
    throw error;
  });
  return trailerAPI;
}

const frameInterval = 7000;

export function HomeHeroMedia({
  title,
  poster,
  trailers,
  screenshots = [],
  muted = true,
  onPlayingChange,
}: {
  title: string;
  poster: string | null;
  trailers: string[];
  screenshots?: string[];
  muted?: boolean;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<TrailerPlayer | null>(null);
  const mutedRef = useRef(muted);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const embed = trailers.map(trailerEmbed).find(Boolean);
  const videoId = embed?.split("/").at(-1);
  const frames = screenshots.slice(0, 6);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  useEffect(() => {
    mutedRef.current = muted;
    if (!player.current) return;
    if (muted) player.current.mute();
    else player.current.unMute();
  }, [muted]);

  // Without a trailer, frames from the episodes take its place and change slowly.
  useEffect(() => {
    if (playing || frames.length < 2) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;
    const timer = setInterval(() => {
      if (!document.hidden) setFrame((value) => (value + 1) % frames.length);
    }, frameInterval);
    return () => clearInterval(timer);
  }, [playing, frames.length]);

  useEffect(() => {
    const container = host.current;
    if (!container || !videoId) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    let started = false;
    let revealed = false;
    let visible = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let reveal: ReturnType<typeof setTimeout> | undefined;
    function stop() {
      clearTimeout(timeout);
      clearTimeout(reveal);
      player.current?.destroy();
      player.current = null;
      setPlaying(false);
      revealed = false;
    }
    function fail() {
      if (active) stop();
    }
    async function start() {
      if (started || preference.matches) return;
      started = true;
      try {
        const api = await loadTrailerAPI();
        if (!active || preference.matches) return;
        const mount = document.createElement("div");
        container!.replaceChildren(mount);
        timeout = setTimeout(fail, 12000);
        player.current = new api.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          videoId: videoId!,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            disablekb: 1,
            rel: 0,
            loop: 1,
            playlist: videoId!,
            origin: window.location.origin,
          },
          events: {
            onReady: ({ target }) => {
              if (!active || preference.matches) return;
              const iframe = target.getIframe();
              iframe.title = `Трейлер: ${title}`;
              iframe.tabIndex = -1;
              iframe.inert = true;
              iframe.setAttribute("aria-hidden", "true");
              if (mutedRef.current) target.mute();
              else target.unMute();
            },
            onStateChange: ({ data }) => {
              if (!active) return;
              clearTimeout(reveal);
              if (data === 1) {
                clearTimeout(timeout);
                if (revealed) {
                  setPlaying(true);
                  return;
                }
                // Hide startup overlays once. Scrolling does not pause or reset this player.
                reveal = setTimeout(() => {
                  if (active && !preference.matches && player.current?.getPlayerState() === 1) {
                    revealed = true;
                    setPlaying(true);
                  }
                }, 3500);
              } else {
                setPlaying(false);
              }
            },
            onError: fail,
            onAutoplayBlocked: fail,
          },
        });
      } catch {
        fail();
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) void start();
      },
      { threshold: 0.15 },
    );
    observer.observe(container);
    const changePreference = () => {
      if (preference.matches) stop();
      else {
        started = false;
        if (visible) void start();
      }
    };
    preference.addEventListener("change", changePreference);
    return () => {
      active = false;
      observer.disconnect();
      preference.removeEventListener("change", changePreference);
      clearTimeout(timeout);
      clearTimeout(reveal);
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId, title]);

  return (
    <div className="home-cinema-media" aria-hidden="true">
      {poster ? (
        <>
          <img className="home-cinema-backdrop" src={poster} alt="" fetchPriority="high" />
          <img className="home-cinema-poster" src={poster} alt="" fetchPriority="high" />
        </>
      ) : (
        <span className="home-cinema-placeholder">AnimeSoul</span>
      )}
      {frames.length > 0 && (
        <div className={`home-cinema-frames${playing ? " is-covered" : ""}`}>
          {frames.map((src, index) => (
            <img
              key={src}
              className={index === frame ? "is-current" : undefined}
              src={src}
              alt=""
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          ))}
        </div>
      )}
      <div ref={host} className={`home-cinema-trailer${playing ? " is-playing" : ""}`} />
    </div>
  );
}
