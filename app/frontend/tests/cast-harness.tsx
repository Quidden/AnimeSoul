// Dev-only UI fixture. Vite's production entry does not include tests/.
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimeSoulPlayer } from "../src/features/player/AnimeSoulPlayer";
import { EMPTY_CAST_STATE, commandCastVideo, type CastState } from "../src/lib/cast";
import type { PlayerMenu } from "../src/features/player/AnimeSoulPlayerMenus";
import "../src/globals.css";

let receiver: CastState = { ...EMPTY_CAST_STATE, available: true, device: "Тестовый телевизор" };
let previousId = "";
let loads = 0;
const emit = (patch: Partial<CastState> = {}) => {
  receiver = { ...receiver, ...patch };
  window.dispatchEvent(new CustomEvent("animesoul:cast-state", { detail: { ...receiver } }));
};
(window as Window & { AnimeSoulCast?: unknown }).AnimeSoulCast = {
  postMessage(raw: string) {
    const command = JSON.parse(raw);
    queueMicrotask(() => {
      if (command.action === "choose") emit({ connected: true });
      else if (command.action === "load") {
        previousId = receiver.id;
        loads += 1;
        emit({ id: command.id, pendingId: "", position: command.position, duration: 600, playing: command.autoplay, finished: false });
      } else if (command.action === "play") emit({ playing: true });
      else if (command.action === "pause") emit({ playing: false });
      else if (command.action === "seek") emit({ position: command.position });
      else if (command.action === "stop") emit({ connected: false, suspended: false });
      else emit();
      document.getElementById("load-count")!.textContent = `Загрузок на ТВ: ${loads}`;
    });
  },
};
const noop = () => undefined;
function Harness() {
  const video = useRef<HTMLVideoElement | null>(null);
  const [episode, setEpisode] = useState("1");
  const [voice, setVoice] = useState("A");
  const [progress, setProgress] = useState("");
  const [teardown, setTeardown] = useState("");
  const [local, setLocal] = useState(false);
  const menu: PlayerMenu = {
    dubbings: [{ value: "A", label: "Озвучка A" }, { value: "B", label: "Озвучка B" }], dubbing: voice, onDubbingChange: setVoice,
    dubbingFavorite: false, onDubbingFavoriteToggle: noop, dubbingGloballyPreferred: false, onDubbingGloballyPreferredToggle: noop,
    seasons: [{ value: "1", label: "Сезон 1" }], season: "1", onSeasonChange: noop,
    episodes: ["1", "2", "3", "4"].map(value => ({ value, label: `Серия ${value}` })), episode, onEpisodeChange: setEpisode,
    sources: [{ value: "AnimeSoul", label: "AnimeSoul" }], source: "AnimeSoul", onSourceChange: noop, subtitles: [],
    autoSkipOpening: false, onAutoSkipOpeningChange: noop, autoSkipEnding: false, onAutoSkipEndingChange: noop,
    autoNext: true, onAutoNextChange: noop, externalToolbarVisible: false, onExternalToolbarVisibleChange: noop,
  };
  return <main style={{ maxWidth: 900, margin: "24px auto", padding: 12 }}>
    <h1>Проверка Google Cast</h1>
    <div style={{ position: "relative", aspectRatio: "16 / 9", minHeight: 220 }}>
      <AnimeSoulPlayer ref={video} title="Тестовый тайтл" seasonLabel="Сезон 1" episodeLabel={`Серия ${episode}`} localPlayback={local} menu={menu}
        request={{ videoId: episode, season: 1, episode, dubbing: voice, iframeUrl: "https://example.com/episode", directStream: { sources: [{ quality: 720, type: "video/mp4", src: `https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4?episode=${episode}&voice=${voice}` }], subtitles: [] } }}
        onTimeUpdate={(time, duration) => setProgress(`${episode}:${Math.floor(time)}/${duration}`)}
        onBeforeTeardown={time => setTeardown(`${episode}:${Math.floor(time)}`)}
        onEnded={() => setEpisode(value => String(Number(value) + 1))} />
    </div>
    <div className="cast-harness-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "20px 0" }}>
      <button onClick={() => emit({ position: 120 })}>ТВ: 120 секунд</button>
      <button onClick={() => setEpisode(value => String(Number(value) + 1))}>Следующая серия</button>
      <button onClick={() => setVoice(value => value === "A" ? "B" : "A")}>Сменить озвучку</button>
      <button onClick={() => { const current = { ...receiver }; emit({ id: previousId, position: 599 }); receiver = current; }}>Позднее событие старой серии</button>
      <button onClick={() => emit({ finished: true, playing: false, position: 600 })}>Конец серии</button>
      <button onClick={() => emit({ suspended: true, connected: false })}>Потеря сети</button>
      <button onClick={() => emit({ suspended: false, connected: true })}>Сеть восстановлена</button>
      <button onClick={() => { if (video.current) commandCastVideo(video.current, "seek", 75); }}>Команда родителя: 75</button>
      <button onClick={() => setLocal(value => !value)}>Локальный файл</button>
    </div>
    <p id="load-count">Загрузок на ТВ: 0</p><p>Прогресс: {progress}</p><p>Сохранение при смене: {teardown}</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
