"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Stream } from "@animesoul/contracts";
import type { PlayerMenu } from "./PlayerMenus";

const DemoPlayer = dynamic(() => import("./NativePlayer").then((module) => module.NativePlayer), {
  ssr: false,
  loading: () => (
    <div className="demo-loading" role="status">
      Загружаем плеер…
    </div>
  ),
});
const clip = "/media/player-demo/city-road-720.webm";
const poster = "/media/player-demo/city-road-poster.jpg";
const demoStream: Extract<Stream, { mode: "direct" }> = {
  mode: "direct",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  sources: [
    { quality: 720, type: "video", src: clip },
    { quality: 360, type: "video", src: "/media/player-demo/city-road-360.webm" },
  ],
};

// The same 18-second clip in a plain player and in the AnimeSoul player, side by side.
// Both start together and stay muted; the AnimeSoul one is the real player with its menus.
export function PlayerDemoPair() {
  const plain = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const synced = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [start, setStart] = useState(0);
  const [chapter, setChapter] = useState("1");
  const [favorite, setFavorite] = useState(false);
  const [failure, setFailure] = useState(false);

  function restart(time: number) {
    synced.current = false;
    setStart(time);
    setFailure(false);
    setGeneration((value) => value + 1);
  }

  // The demo must not start sound by itself. The player resets its own mute state while it
  // loads, so keep it muted for a few seconds, until the visitor touches the player.
  useEffect(() => {
    const node = screen.current;
    if (!node) return;
    let touched = false;
    let attempts = 0;
    const touch = () => {
      touched = true;
    };
    node.addEventListener("pointerdown", touch, { capture: true, once: true });
    const timer = setInterval(() => {
      if (touched || ++attempts > 50) return clearInterval(timer);
      node.querySelectorAll("video").forEach((video) => {
        video.muted = true;
      });
    }, 120);
    return () => {
      clearInterval(timer);
      node.removeEventListener("pointerdown", touch, { capture: true });
    };
  }, [generation]);

  const menu: PlayerMenu = {
    contextLabel: "Демо · Путь к городу",
    seasons: [{ value: "1", label: "Демонстрация" }],
    season: "1",
    onSeasonChange: () => undefined,
    episodes: [
      { value: "1", label: "Начало пути" },
      { value: "2", label: "Вторая половина" },
    ],
    episode: chapter,
    onEpisodeChange: (value) => {
      setChapter(value);
      restart(value === "2" ? 9 : 0);
    },
    dubbings: [{ value: "original", label: "Без речи", favorite }],
    dubbing: "original",
    onDubbingChange: () => undefined,
    onFavoriteDubbing: (_value, enabled) => setFavorite(enabled),
    preferences: { resume: true, autoplay: true, notice: "", onChange: () => undefined },
  };

  return (
    <div className="demo-pair">
      <figure className="demo-card">
        <figcaption>
          <strong>Обычный плеер</strong>
          <span>перемотка и громкость</span>
        </figcaption>
        <div className="demo-screen">
          <video
            ref={plain}
            src={clip}
            poster={poster}
            muted
            loop
            playsInline
            controls
            controlsList="nodownload"
            autoPlay={failure}
            preload="auto"
            aria-label="Фрагмент в обычном плеере"
          />
        </div>
        <p>Серия, озвучка и качество выбираются вне видео.</p>
      </figure>
      <figure className="demo-card is-plus">
        <figcaption>
          <span className="player-plus-tag">PLUS</span>
          <strong>Плеер AnimeSoul</strong>
          <span>меню внутри видео</span>
        </figcaption>
        <div className="demo-screen" ref={screen}>
          {failure ? (
            <div className="demo-loading" role="alert">
              Не удалось загрузить демо.{" "}
              <button className="text-link" type="button" onClick={() => restart(start)}>
                Повторить
              </button>
            </div>
          ) : (
            <DemoPlayer
              key={generation}
              stream={demoStream}
              start={start}
              title="Путь к городу"
              poster={poster}
              menu={menu}
              loop
              onRefresh={async () => true}
              onFallback={() => setFailure(true)}
              onTime={(position, _duration, playing) => {
                const video = plain.current;
                if (!video || !playing || synced.current) return;
                synced.current = true;
                video.currentTime = position;
                void video.play().catch(() => undefined);
              }}
            />
          )}
        </div>
        <p>Нажмите на шестерёнку: серия, озвучка, качество, скорость и Anime4K.</p>
      </figure>
      <p className="demo-note">
        Фрагмент «Путь к городу», 18 секунд по кругу, звук выключен.{" "}
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setChapter("1");
            restart(0);
            const video = plain.current;
            if (video) video.currentTime = 0;
          }}
        >
          Смотреть сначала
        </button>
      </p>
    </div>
  );
}
