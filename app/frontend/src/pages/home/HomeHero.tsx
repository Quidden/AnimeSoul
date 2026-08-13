import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { EpisodeSlideshow, episodePreviewImages } from "../../components/EpisodeSlideshow";
import { Toggle } from "../../components/Toggle";
import { formatTime } from "../../lib/anime";
import { homeTrailerEmbedUrl, isYouTubeTrailer } from "../../lib/trailer";
import type { HeroTrailer, PlayerPrefs } from "../../lib/types";
import type { HomePageActions, HomePageModel, HomePageProps } from "./types";

const YOUTUBE_UI_SETTLE_MS = 2300;
const YOUTUBE_LOAD_FALLBACK_MS = 3000;

export function PartyNow({
  party,
  onOpen,
}: {
  party: HomePageModel["party"];
  onOpen: HomePageActions["openAnime"];
}) {
  const { session, state, host, playback, anime } = party;
  if (!session || !playback) return null;

  const roomMode = state?.roomMode === "shared"
    ? "ОБЩЕЕ УПРАВЛЕНИЕ"
    : "УПРАВЛЯЕТ ХОСТ";

  return (
    <section className="party-host-now home-party-now">
      <span>
        <i />
        <small>СОВМЕСТНЫЙ ПРОСМОТР · {roomMode}</small>
        <b>
          {host?.name ?? "Хост"} смотрит: {anime?.title ?? `аниме #${playback.animeId}`}
        </b>
        <em>
          Сезон {playback.season} · серия {playback.episode} ·{" "}
          {formatTime(playback.position)}
        </em>
      </span>
      {anime && (
        <button className="primary" onClick={() => onOpen(anime, false)}>
          Открыть просмотр
        </button>
      )}
    </section>
  );
}

/** Full-viewport continuation banner. Media is decorative; the whole hero resumes playback. */
export function HomeHero({ model, actions }: HomePageProps) {
  const { resume, playerPrefs } = model;
  const { anime, state, point } = resume;
  const hasResume = Boolean(anime && state);

  const openHero = () => {
    if (anime && state) actions.openAnime(anime, true);
    else actions.chooseCatalog();
  };

  const onHeroClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, input, select, details, summary")) {
      return;
    }
    openHero();
  };

  const onHeroKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openHero();
    }
  };

  const seasonLabel = state?.seasonLabel
    ?? `Сезон ${point?.season ?? state?.season ?? 1}`;
  const position = point?.state.position ?? 0;

  return (
    <section
      className={`home-cinema-hero ${hasResume ? "has-resume" : "empty-resume"}`}
      role="link"
      tabIndex={0}
      aria-label={hasResume ? `Продолжить ${anime?.title}` : "Выбрать аниме"}
      onClick={onHeroClick}
      onKeyDown={onHeroKeyDown}
    >
      <HeroMedia model={model} actions={actions} />
      <div className="home-cinema-vignette" />

      {model.totalNewEpisodes > 0 && (
        <button
          type="button"
          className="home-new-episodes-pill"
          onClick={event => {
            event.stopPropagation();
            document
              .getElementById("home-tracking-panel")
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          <i aria-hidden="true" />
          <span>Замечены новые серии</span>
          <b>+{model.totalNewEpisodes}</b>
        </button>
      )}

      <div className="home-cinema-copy">
        <button type="button" className="eyebrow hero-resume-label" onClick={openHero}>
          {hasResume ? "ПРОДОЛЖИТЬ ПРОСМОТР" : "ВЫБРАТЬ ЧТО ПОСМОТРЕТЬ"}
        </button>
        {hasResume && anime && state ? (
          <>
            <h1>{anime.title}</h1>
            <p>
              {seasonLabel} · серия {resume.displayEpisode} · остановились на{" "}
              {formatTime(position)}
            </p>
            <span className="home-cinema-cta">▶ Продолжить с {formatTime(position)}</span>
          </>
        ) : (
          <>
            <h1>Твоя коллекция.<br /><i>Твои правила.</i></h1>
            <p>Незавершённого просмотра пока нет — выбери новое аниме в каталоге.</p>
            <span className="home-cinema-cta">⌕ Открыть каталог</span>
          </>
        )}
      </div>

      <div className="home-hero-settings-wrap" onClick={event => event.stopPropagation()}>
        <ResumeSettings prefs={playerPrefs} onUpdate={actions.updatePlayerPrefs} />
      </div>
    </section>
  );
}

function HeroMedia({ model, actions }: HomePageProps) {
  const { resume, playerPrefs } = model;
  const { anime, previewAnime, previewVideo, displayEpisode, trailer } = resume;
  const previewEnabled = Boolean(anime && playerPrefs.homeEpisodePreview);
  const fallback = previewAnime?.poster?.fullsize
    ?? previewAnime?.poster?.big
    ?? anime?.poster?.fullsize
    ?? anime?.poster?.big;

  if (previewEnabled && trailer) {
    return <TrailerMedia trailer={trailer} fallback={fallback} />;
  }

  if (previewEnabled && playerPrefs.homePreviewMode === "screenshots" && anime) {
    return (
      <div className="home-cinema-media home-cinema-episode-media" aria-hidden="true">
        <EpisodeSlideshow
          className="home-cinema-slideshow"
          images={episodePreviewImages(previewAnime ?? anime, displayEpisode)}
          fallback={fallback}
          allowLowQuality
          label=""
          iframeUrl={previewVideo?.iframe_url}
          duration={previewVideo?.duration ?? resume.point?.state.duration ?? 1440}
          onClick={() => actions.openAnime(anime, true)}
        />
      </div>
    );
  }

  return (
    <div className="home-cinema-media" aria-hidden="true">
      {fallback
        ? <img src={fallback} alt="" />
        : <span className="home-cinema-placeholder">AnimeSoul</span>}
    </div>
  );
}

function TrailerMedia({
  trailer,
  fallback,
}: {
  trailer: HeroTrailer;
  fallback?: string;
}) {
  const startAt = useMemo(() => randomTrailerStart(), [trailer.url]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const revealTimerRef = useRef<number | null>(null);
  const revealAtRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const poster = trailer.poster ?? fallback;

  const reveal = useCallback((delay = 0) => {
    const revealAt = performance.now() + delay;
    if (revealTimerRef.current !== null && revealAtRef.current <= revealAt) return;
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealAtRef.current = revealAt;
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      revealAtRef.current = 0;
      setIsPlaying(true);
    }, delay);
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
      revealAtRef.current = 0;
    }
  }, [trailer.url]);

  useEffect(() => {
    if (trailer.kind !== "embed" || !isYouTubeTrailer(trailer.url)) return;

    const handlePlayerMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;

      let message: unknown = event.data;
      if (typeof message === "string") {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      if (!message || typeof message !== "object") return;

      const payload = message as {
        event?: string;
        info?: number | { playerState?: number; currentTime?: number } | null;
      };
      const info = payload.info && typeof payload.info === "object"
        ? payload.info
        : undefined;
      const playerState = typeof payload.info === "number"
        ? payload.info
        : info?.playerState;
      const currentTime = info?.currentTime;
      // YouTube briefly draws its central pause glyph after autoplay begins,
      // even with controls=0. Keep the preview image above the iframe until
      // that transient overlay has finished fading out.
      if (playerState === 1 || (currentTime ?? 0) > 0) reveal(YOUTUBE_UI_SETTLE_MS);
    };

    const requestPlayerState = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(JSON.stringify({ event: "listening", id: "animesoul-home-trailer" }), "*");
      target.postMessage(JSON.stringify({
        event: "command",
        func: "getPlayerState",
        args: [],
        id: "animesoul-home-trailer",
      }), "*");
    };

    window.addEventListener("message", handlePlayerMessage);
    const poll = window.setInterval(requestPlayerState, 250);
    requestPlayerState();
    return () => {
      window.removeEventListener("message", handlePlayerMessage);
      window.clearInterval(poll);
    };
  }, [reveal, trailer.kind, trailer.url]);

  useEffect(() => () => {
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
      revealAtRef.current = 0;
    }
  }, []);

  if (trailer.kind === "video") {
    return (
      <div className={`home-cinema-media home-cinema-trailer ${isPlaying ? "is-playing" : "is-loading"}`} aria-hidden="true">
        {poster && <img className="home-cinema-trailer-poster" src={poster} alt="" fetchPriority="high" />}
        <video
          key={trailer.url}
          src={trailer.url}
          poster={poster}
          autoPlay
          controls={false}
          muted
          loop
          playsInline
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
          preload="auto"
          onPlaying={() => reveal()}
          onLoadedMetadata={event => {
            const video = event.currentTarget;
            const maxStart = Math.max(0, video.duration - 8);
            video.currentTime = Math.min(startAt, maxStart);
            void video.play().catch(() => undefined);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`home-cinema-media home-cinema-trailer ${isPlaying ? "is-playing" : "is-loading"}`} aria-hidden="true">
      {poster && <img className="home-cinema-trailer-poster" src={poster} alt="" fetchPriority="high" />}
      <iframe
        ref={iframeRef}
        key={trailer.url}
        src={homeTrailerEmbedUrl(
          trailer.url,
          startAt,
          typeof window === "undefined" ? undefined : window.location.origin,
        )}
        title=""
        tabIndex={-1}
        allow="autoplay; encrypted-media"
        allowFullScreen={false}
        onLoad={() => reveal(isYouTubeTrailer(trailer.url) ? YOUTUBE_LOAD_FALLBACK_MS : 250)}
      />
    </div>
  );
}

function randomTrailerStart() {
  return 8 + Math.floor(Math.random() * 29);
}

function ResumeSettings({
  prefs,
  onUpdate,
}: {
  prefs: PlayerPrefs;
  onUpdate: HomePageActions["updatePlayerPrefs"];
}) {
  const previewClass = prefs.homeEpisodePreview ? "enabled" : "disabled";

  return (
    <details className="compact-options hero-options">
      <summary>⚙ Настройки продолжения</summary>
      <div>
        <Toggle
          label="Автоматически запускать продолжение"
          value={prefs.autoPlayResume}
          onChange={autoPlayResume => onUpdate({ autoPlayResume })}
        />
        <Toggle
          label="Трейлер или предпросмотр на главной"
          value={prefs.homeEpisodePreview}
          onChange={homeEpisodePreview => onUpdate({ homeEpisodePreview })}
        />
        <div className={`preview-mode-field ${previewClass}`}>
          <span>Резерв, если трейлера нет</span>
          <div className="preview-mode-switch" role="group" aria-label="Режим предпросмотра">
            <button
              type="button"
              disabled={!prefs.homeEpisodePreview}
              className={prefs.homePreviewMode === "poster" ? "active" : ""}
              onClick={() => onUpdate({ homePreviewMode: "poster" })}
            >
              HD-картинка
            </button>
            <button
              type="button"
              disabled={!prefs.homeEpisodePreview}
              className={prefs.homePreviewMode === "screenshots" ? "active" : ""}
              onClick={() => onUpdate({ homePreviewMode: "screenshots" })}
            >
              Кадры серии
            </button>
          </div>
          <small>Приоритет: трейлер сезона → трейлер аниме → выбранный резерв.</small>
        </div>
      </div>
    </details>
  );
}
