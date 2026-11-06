"use client";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { seasonLabel } from "../lib/season-label";
import type { Stream } from "@animesoul/contracts";
import {
  PlayerMenuSelect,
  PlayerTopNavigation,
  PlayerPlaybackSettings,
  PlayerEpisodeFields,
  type PlayerMenu,
} from "./PlayerMenus";
import { useVideoAmbient } from "./useVideoAmbient";
import { useUpscale } from "./useUpscale";
import { useNativeSource } from "./useNativeSource";
import { PlayerTimelinePreview } from "./PlayerTimelinePreview";
import { PlayerSelect } from "./PlayerSelect";
import { AnimePartSwitches } from "./AnimePartSwitches";
import type { UpscaleTarget, UpscaleProfile } from "../lib/upscale";
import { PlayerLoadingHint, type ProgressStatus } from "./PlayerLoadingHint";
type Direct = Extract<Stream, { mode: "direct" }>;
function clock(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function NativePlayer({
  stream,
  start,
  title,
  poster,
  menu,
  onTime,
  onFallback,
  onRefresh,
  autoplay = true,
  loop = false,
  progressStatus = "guest",
}: {
  stream: Direct;
  start: number;
  title: string;
  poster?: string | undefined;
  menu: PlayerMenu;
  onTime: (position: number, duration: number, playing: boolean, ended?: boolean) => void;
  onFallback: () => void;
  onRefresh: () => Promise<boolean>;
  autoplay?: boolean;
  loop?: boolean;
  progressStatus?: ProgressStatus;
}) {
  const video = useRef<HTMLVideoElement>(null),
    shell = useRef<HTMLDivElement>(null),
    position = useRef(start),
    callback = useRef(onTime),
    fallback = useRef(onFallback),
    refresh = useRef(onRefresh),
    switching = useRef(false),
    shouldPlay = useRef(autoplay),
    controlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    controlsHeld = useRef(false);
  const renewing = useRef(false);
  callback.current = onTime;
  fallback.current = onFallback;
  refresh.current = onRefresh;
  function fallbackToEmbed(reason: string) {
    if (process.env.NODE_ENV === "development") console.warn("Video fallback:", reason);
    fallback.current();
  }
  async function renewStream() {
    if (renewing.current) return true;
    renewing.current = true;
    try {
      return await refresh.current();
    } finally {
      renewing.current = false;
    }
  }
  const [quality, setQuality] = useState(stream.sources[0]?.quality),
    [rate, setRate] = useState(1),
    [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState(true),
    [currentTime, setCurrentTime] = useState(start),
    [duration, setDuration] = useState(0),
    [buffered, setBuffered] = useState(0),
    [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false),
    [visible, setVisible] = useState(true),
    [settingsOpen, setSettingsOpen] = useState(false),
    [pickerOpen, setPickerOpen] = useState(false),
    [fit, setFit] = useState<"contain" | "cover">("contain"),
    [fullScreen, setFullScreen] = useState(false),
    [pipSupported, setPipSupported] = useState(false),
    [notice, setNotice] = useState(""),
    [selectOpen, setSelectOpen] = useState(false);
  const currentRate = useRef(rate),
    playingNow = useRef(playing),
    menuOpen = useRef(false);
  currentRate.current = rate;
  playingNow.current = playing;
  menuOpen.current = settingsOpen || pickerOpen || selectOpen;
  function reveal() {
    clearTimeout(controlsTimer.current);
    setVisible(true);
    controlsTimer.current = setTimeout(() => {
      if (playingNow.current && !menuOpen.current && !controlsHeld.current) setVisible(false);
    }, 3000);
  }
  useEffect(() => {
    setPipSupported(document.pictureInPictureEnabled);
    const changed = () => setFullScreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      clearTimeout(controlsTimer.current);
      clearTimeout(tapTimer.current);
    };
  }, []);
  const source = stream.sources.find((item) => item.quality === quality) ?? stream.sources[0];
  const native = useNativeSource({
    source,
    video,
    position,
    shouldPlay,
    onReady: (element) => {
      switching.current = false;
      setLoading(false);
      setCurrentTime(element.currentTime);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      setPlaying(!element.paused);
      setNotice("");
    },
    onFailure: (previous) => {
      setQuality(previous);
      setNotice("Не удалось загрузить это качество. Продолжаем текущий поток.");
    },
    onFallback: () => fallbackToEmbed("stream-load-failed"),
    onRefresh: renewStream,
  });
  const upscale = useUpscale(video, native.sourceKey);
  useVideoAmbient(video, native.sourceKey);
  const [preview, setPreview] = useState<{ time: number; percent: number } | null>(null);
  const previewSource = [...stream.sources].sort((a, b) => a.quality - b.quality)[0];
  useEffect(() => {
    const root = shell.current;
    if (!root) return;
    const menus = new Set<string>();
    const changed = (event: Event) => {
      const { id, open } = (event as CustomEvent<{ id: string; open: boolean }>).detail;
      if (open) menus.add(id);
      else menus.delete(id);
      setSelectOpen(menus.size > 0);
    };
    root.addEventListener("animesoul:player-menu", changed);
    return () => root.removeEventListener("animesoul:player-menu", changed);
  }, []);
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate, source]);
  useEffect(() => {
    let active = true;
    const delay = Math.max(0, new Date(stream.expiresAt).getTime() - Date.now() - 30000);
    const timer = setTimeout(() => {
      void renewStream()
        .then((renewed) => {
          if (active && !renewed) fallbackToEmbed("stream-refresh-failed");
        })
        .catch(() => {
          if (active) fallbackToEmbed("stream-refresh-failed");
        });
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [stream.expiresAt]);
  function report(ended = false, playing?: boolean) {
    const element = video.current;
    if (
      !element ||
      switching.current ||
      !Number.isFinite(element.duration) ||
      element.duration <= 0
    )
      return;
    position.current = element.currentTime;
    setCurrentTime(element.currentTime);
    setDuration(element.duration);
    callback.current(
      element.currentTime,
      Number.isFinite(element.duration) ? element.duration : 0,
      playing ?? (!element.paused && !element.ended),
      ended,
    );
  }
  function togglePlayback() {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      shouldPlay.current = true;
      void element.play().catch(() => setNotice("Нажмите воспроизведение ещё раз."));
    } else {
      shouldPlay.current = false;
      element.pause();
    }
    reveal();
  }
  function seek(value: number) {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.max(0, Math.min(value, element.duration));
    setCurrentTime(element.currentTime);
    report(false, false);
    reveal();
  }
  function changeVolume(value: number) {
    const element = video.current;
    if (!element) return;
    element.volume = Math.max(0, Math.min(1, value));
    element.muted = element.volume === 0;
    setVolume(element.volume);
    setMuted(element.muted);
    reveal();
  }
  function toggleMute() {
    const element = video.current;
    if (!element) return;
    if (element.volume === 0) changeVolume(0.5);
    else {
      element.muted = !element.muted;
      setMuted(element.muted);
    }
    reveal();
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === shell.current) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch {
      setNotice("Полный экран недоступен в этом браузере.");
    }
    reveal();
  }
  async function togglePip() {
    try {
      if (document.pictureInPictureElement === video.current) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch {
      setNotice("Картинка в картинке сейчас недоступна.");
    }
  }
  function changeUpscale(target: UpscaleTarget) {
    report();
    upscale.select(target);
    if (target) setQuality(Math.max(...stream.sources.map((item) => item.quality)));
    reveal();
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (settingsOpen || pickerOpen || selectOpen) {
        event.preventDefault();
        event.stopPropagation();
      }
      setSettingsOpen(false);
      setPickerOpen(false);
      reveal();
      return;
    }
    if (
      (event.target as HTMLElement).closest("input,select,button") ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    switch (event.key.toLowerCase()) {
      case " ":
      case "k":
        event.preventDefault();
        togglePlayback();
        break;
      case "arrowleft":
        event.preventDefault();
        seek(currentTime - 5);
        break;
      case "arrowright":
        event.preventDefault();
        seek(currentTime + 5);
        break;
      case "arrowup":
        event.preventDefault();
        changeVolume(volume + 0.05);
        break;
      case "arrowdown":
        event.preventDefault();
        changeVolume(volume - 0.05);
        break;
      case "m":
        event.preventDefault();
        toggleMute();
        break;
      case "f":
        event.preventDefault();
        void toggleFullscreen();
        break;
      case "i":
        if (pipSupported) {
          event.preventDefault();
          void togglePip();
        }
        break;
    }
  }
  const controlsShown = visible || !playing || loading || settingsOpen || pickerOpen || selectOpen;
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedProgress = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  return (
    <div
      ref={shell}
      className={`animesoul-player${controlsShown ? " controls-visible" : ""}${loading ? " is-loading" : ""}${fit === "cover" ? " fit-cover" : ""}${preview ? " timeline-preview-visible" : ""}`}
      aria-label={`Плеер AnimeSoul: ${title}`}
      tabIndex={0}
      onKeyDown={keyboard}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch")
          controlsHeld.current = Boolean(
            (event.target as HTMLElement).closest(
              "button,input,select,.animesoul-player-controls,.animesoul-player-top-navigation",
            ),
          );
        reveal();
      }}
      onPointerLeave={() => {
        controlsHeld.current = false;
        reveal();
      }}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) controlsHeld.current = true;
        reveal();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          controlsHeld.current = false;
          reveal();
        }
      }}
    >
      {[0, 1].map((slot) => (
        <video
          key={slot}
          ref={(element) => {
            native.elements.current[slot] = element;
            if (element && !video.current && slot === 0) video.current = element;
          }}
          className={`animesoul-player-video${slot !== native.slot ? " player-standby-video" : ""}`}
          aria-hidden={slot !== native.slot}
          playsInline
          loop={loop}
          preload="auto"
          poster={poster}
          crossOrigin="anonymous"
          aria-label={`${title} — серия ${menu.episode}`}
          onClick={(event) => {
            clearTimeout(tapTimer.current);
            if (event.detail === 1) tapTimer.current = setTimeout(togglePlayback, 220);
          }}
          onDoubleClick={() => {
            clearTimeout(tapTimer.current);
            void toggleFullscreen();
          }}
          onTimeUpdate={(event) => {
            if (event.currentTarget === video.current) report();
          }}
          onPlay={(event) => {
            if (event.currentTarget === video.current && !switching.current) {
              shouldPlay.current = true;
              setPlaying(true);
              reveal();
            }
          }}
          onPlaying={(event) => {
            if (event.currentTarget !== video.current) return;
            setLoading(false);
            setPlaying(true);
            reveal();
            report();
          }}
          onCanPlay={(event) => {
            if (event.currentTarget === video.current) setLoading(false);
          }}
          onWaiting={(event) => {
            if (event.currentTarget !== video.current) return;
            setLoading(true);
            report(false, false);
          }}
          onSeeking={(event) => {
            if (event.currentTarget === video.current) report(false, false);
          }}
          onSeeked={(event) => {
            if (event.currentTarget !== video.current) return;
            setLoading(false);
            report();
          }}
          onPause={(event) => {
            if (event.currentTarget === video.current && !switching.current) {
              shouldPlay.current = false;
              setPlaying(false);
              setVisible(true);
              report();
            }
          }}
          onEnded={(event) => {
            if (event.currentTarget !== video.current) return;
            shouldPlay.current = false;
            setPlaying(false);
            setVisible(true);
            report(true);
          }}
          onProgress={(event) => {
            if (event.currentTarget !== video.current) return;
            const element = video.current;
            if (element)
              setBuffered(
                element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0,
              );
          }}
          onVolumeChange={(event) => {
            if (event.currentTarget !== video.current) return;
            if (video.current) {
              setVolume(video.current.volume);
              setMuted(video.current.muted);
            }
          }}
        />
      ))}
      {upscale.overlay}
      <div inert={!controlsShown}>
        <PlayerTopNavigation
          title={title}
          menu={menu}
          open={pickerOpen}
          onToggle={() => {
            setSettingsOpen(false);
            setPickerOpen((value) => !value);
            reveal();
          }}
        />
      </div>
      {loading && (
        <div className="animesoul-player-loader compact" role="status">
          <i />
          <span>Буферизация…</span>
        </div>
      )}
      <PlayerLoadingHint loading={loading} progressStatus={progressStatus} />
      {native.pending && native.sourceKey && (
        <div className="player-quality-pending" role="status">
          Подготавливаем качество…
        </div>
      )}
      {(notice || (!settingsOpen && upscale.notice)) && (
        <div className="animesoul-version-notice" role="status">
          {notice || upscale.notice}
        </div>
      )}
      {!playing && !loading && (
        <button
          type="button"
          className="animesoul-player-center-play"
          aria-label="Воспроизвести"
          onClick={togglePlayback}
        >
          ▶
        </button>
      )}
      <div className="animesoul-player-controls" inert={!controlsShown}>
        <div
          className="animesoul-player-timeline"
          onPointerMove={(event) => {
            if (!duration || event.pointerType === "touch") return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const percent = Math.max(
              0,
              Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100),
            );
            setPreview({ time: (duration * percent) / 100, percent });
          }}
          onPointerLeave={() => setPreview(null)}
          style={
            {
              "--player-progress": `${progress}%`,
              "--player-buffered": `${bufferedProgress}%`,
              "--player-preview-position": `${preview?.percent ?? progress}%`,
            } as CSSProperties
          }
        >
          <PlayerTimelinePreview
            source={previewSource}
            time={preview?.time ?? currentTime}
            visible={Boolean(preview)}
            suspended={loading || native.pending}
          />
          <div className="animesoul-player-timeline-rail" aria-hidden="true">
            <span className="buffered" />
            <span className="played" />
            <b className="thumb" />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            aria-label="Позиция видео"
            aria-valuetext={`${clock(currentTime)} из ${clock(duration)}`}
            onChange={(event) => seek(Number(event.target.value))}
            onFocus={() => setPreview({ time: currentTime, percent: progress })}
            onBlur={() => setPreview(null)}
            onKeyUp={(event) => {
              const position = Number(event.currentTarget.value);
              setPreview({ time: position, percent: duration ? (position / duration) * 100 : 0 });
            }}
          />
        </div>
        <div className="animesoul-player-control-row">
          <button
            type="button"
            aria-label={playing ? "Пауза" : "Воспроизвести"}
            onClick={togglePlayback}
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button
            type="button"
            aria-label={muted ? "Включить звук" : "Выключить звук"}
            onClick={toggleMute}
          >
            {muted || volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            className="animesoul-player-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label="Громкость"
            onChange={(event) => changeVolume(Number(event.target.value))}
          />
          <span className="animesoul-player-time">
            {clock(currentTime)} / {clock(duration)}
          </span>
          <span className="animesoul-player-spacer" />
          <span className="animesoul-player-no-subs" title="У этой версии нет отдельных субтитров">
            CC
          </span>
          <PlayerSelect
            compact
            label="Скорость"
            ariaLabel="Скорость воспроизведения"
            value={String(rate)}
            options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({
              value: String(value),
              label: `${value}×`,
            }))}
            onChange={(value) => setRate(Number(value))}
          />
          <PlayerSelect
            compact
            label="Качество"
            ariaLabel="Качество видео"
            value={
              upscale.target ? `upscale:${upscale.target}` : `source:${source?.quality ?? quality}`
            }
            options={[
              ...[...new Set(stream.sources.map((item) => item.quality))].map((value) => ({
                value: `source:${value}`,
                label: `${value}p`,
                group: "Качество потока",
              })),
              { value: "upscale:1080", label: "1080p · Anime4K", group: "Апскейл Anime4K" },
              { value: "upscale:1440", label: "2K · Anime4K", group: "Апскейл Anime4K" },
              { value: "upscale:2160", label: "4K · Anime4K", group: "Апскейл Anime4K" },
            ]}
            onChange={(value) => {
              const [mode, height] = value.split(":");
              if (mode === "upscale") changeUpscale(Number(height) as UpscaleTarget);
              else {
                report();
                upscale.select(0);
                setQuality(Number(height));
                reveal();
              }
            }}
          />
          {pipSupported && (
            <button
              type="button"
              className="animesoul-player-pip-button"
              aria-label="Картинка в картинке"
              title="Картинка в картинке"
              onClick={() => void togglePip()}
            >
              ▣
            </button>
          )}
          <button
            type="button"
            className={`animesoul-player-settings-button${settingsOpen ? " active" : ""}`}
            aria-label="Настройки плеера"
            title="Настройки плеера"
            aria-expanded={settingsOpen}
            onClick={() => {
              setPickerOpen(false);
              setSettingsOpen((value) => !value);
              reveal();
            }}
          >
            ⚙
          </button>
          <button
            type="button"
            aria-label={fullScreen ? "Выйти из полного экрана" : "Полный экран"}
            title="Полный экран"
            onClick={() => void toggleFullscreen()}
          >
            ⛶
          </button>
        </div>
      </div>
      {settingsOpen && (
        <aside className="animesoul-player-settings" aria-label="Настройки плеера">
          <header>
            <div>
              <strong>Настройки</strong>
              <span>
                {menu.contextLabel ?? `${seasonLabel(menu.season)} · Серия ${menu.episode}`}
              </span>
            </div>
            <button
              type="button"
              aria-label="Закрыть настройки"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="animesoul-player-settings-content">
            <PlayerMenuSelect
              label="Озвучка"
              ariaLabel="Озвучка в настройках"
              value={menu.dubbing}
              options={menu.dubbings}
              onChange={menu.onDubbingChange}
              onFavorite={menu.onFavoriteDubbing}
            />
            {!!menu.filters?.length && (
              <AnimePartSwitches filters={menu.filters} label="Типы частей в настройках плеера" />
            )}
            <PlayerEpisodeFields menu={menu} settings />
            <PlayerMenuSelect
              label="Отображение видео"
              value={fit}
              options={[
                { value: "contain", label: "Показывать целиком" },
                { value: "cover", label: "Заполнить экран" },
              ]}
              onChange={(value) => setFit(value === "cover" ? "cover" : "contain")}
            />
            <PlayerMenuSelect
              label="Апскейл Anime4K"
              value={String(upscale.target)}
              options={[
                { value: "0", label: "Исходное видео" },
                { value: "1080", label: "1080p · Full HD" },
                { value: "1440", label: "2K · 1440p" },
                { value: "2160", label: "4K · 2160p" },
              ]}
              onChange={(value) => changeUpscale(Number(value) as UpscaleTarget)}
            />
            {!!upscale.target && (
              <PlayerMenuSelect
                label="Профиль Anime4K"
                value={upscale.profile}
                options={[
                  { value: "light", label: "Лёгкий · плавность" },
                  { value: "advanced", label: "Продвинутый · детализация" },
                ]}
                onChange={(value) => upscale.setProfile(value as UpscaleProfile)}
              />
            )}
            {(upscale.notice || upscale.target > 0) && (
              <p className="player-upscale-info" role="status">
                {upscale.notice || upscale.info || "Подготавливаем Anime4K…"}
              </p>
            )}
            <div className="animesoul-player-stream-state">
              <span>Поток</span>
              <strong>{quality}p</strong>
            </div>
            <PlayerPlaybackSettings menu={menu} />
          </div>
        </aside>
      )}
    </div>
  );
}
