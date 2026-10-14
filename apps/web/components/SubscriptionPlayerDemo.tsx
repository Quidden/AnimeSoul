"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Stream } from "@animesoul/contracts";
import type { PlayerMenu } from "./PlayerMenus";

const DemoPlayer = dynamic(() => import("./NativePlayer").then((module) => module.NativePlayer), {
  ssr: false,
  loading: () => (
    <div className="subscription-demo-loading" role="status">
      Подготавливаем демо…
    </div>
  ),
});
const demoStream: Extract<Stream, { mode: "direct" }> = {
  mode: "direct",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  sources: [
    { quality: 720, type: "video", src: "/media/player-demo/city-road-720.webm" },
    { quality: 360, type: "video", src: "/media/player-demo/city-road-360.webm" },
  ],
};
const progressKey = "animesoul:player-demo:city-road:v1";
function clock(time: number) {
  return `0:${String(Math.floor(time)).padStart(2, "0")}`;
}
export function SubscriptionPlayerDemo() {
  const [started, setStarted] = useState(false);
  const [failure, setFailure] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [saved, setSaved] = useState(0);
  const [start, setStart] = useState(0);
  const [chapter, setChapter] = useState("1");
  const [favorite, setFavorite] = useState(false);
  const [resume, setResume] = useState(true);
  const [autoplay, setAutoplay] = useState(true);
  const lastSave = useRef(0);
  useEffect(() => {
    try {
      const time = Number(localStorage.getItem(progressKey));
      if (Number.isFinite(time) && time >= 0 && time < 18) setSaved(time);
    } catch {
      /* The demo also works without browser storage. */
    }
  }, []);
  function launch(time: number) {
    setStart(time);
    setFailure(false);
    setStarted(true);
    setGeneration((value) => value + 1);
  }
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
      launch(value === "2" ? 9 : 0);
    },
    dubbings: [{ value: "original", label: "Без речи", favorite }],
    dubbing: "original",
    onDubbingChange: () => undefined,
    onFavoriteDubbing: (_value, enabled) => setFavorite(enabled),
    preferences: {
      resume,
      autoplay,
      notice: "",
      onChange: (update) => {
        if (update.resume !== undefined) setResume(update.resume);
        if (update.autoplay !== undefined) setAutoplay(update.autoplay);
      },
    },
  };
  return (
    <section className="subscription-demo" aria-labelledby="subscription-demo-title">
      <div className="subscription-demo-heading">
        <h3 id="subscription-demo-title">Попробуй плеер прямо здесь</h3>
        <p>
          Открой меню, перемотай кадр, выбери скорость и качество. Демо доступно без регистрации.
        </p>
      </div>
      <div className="subscription-demo-screen">
        {started && !failure ? (
          <DemoPlayer
            key={generation}
            stream={demoStream}
            start={start}
            title="Путь к городу"
            poster="/media/player-demo/city-road-poster.jpg"
            menu={menu}
            loop={autoplay}
            onRefresh={async () => true}
            onFallback={() => setFailure(true)}
            onTime={(time, duration, playing) => {
              if (!resume || duration <= 0 || time >= 18 || !Number.isFinite(time)) return;
              if (playing && Date.now() - lastSave.current < 2000) return;
              lastSave.current = Date.now();
              setSaved(time);
              try {
                localStorage.setItem(progressKey, String(time));
              } catch {
                /* Optional. */
              }
            }}
          />
        ) : (
          <div className="subscription-demo-start">
            <img
              src="/media/player-demo/city-road-poster.jpg"
              alt="Путник на дороге к городу в закатном свете"
              width="1280"
              height="720"
            />
            <div>
              {failure && <p role="alert">Не удалось загрузить демо. Попробуй ещё раз.</p>}
              <button className="primary" onClick={() => launch(resume ? saved : 0)}>
                {failure
                  ? "Повторить загрузку"
                  : resume && saved > 1
                    ? `Продолжить демо с ${clock(saved)}`
                    : "Запустить демоплеер"}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="subscription-demo-footer">
        <p>«Путь к городу», 18 секунд. Один фрагмент, два момента для перемотки.</p>
        {started && (
          <button
            className="outline"
            onClick={() => {
              setChapter("1");
              launch(0);
            }}
          >
            Смотреть сначала
          </button>
        )}
      </div>
      <p className="subscription-demo-hint">
        Настройки находятся внизу справа. Anime4K и картинка в картинке доступны в совместимых
        браузерах.
      </p>
    </section>
  );
}
