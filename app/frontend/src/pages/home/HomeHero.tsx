import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { EpisodeSlideshow, episodePreviewImages } from "../../components/EpisodeSlideshow";
import { formatTime } from "../../lib/anime";
import { IS_ANDROID_APP } from "../../lib/platform";
import { homeTrailerEmbedUrl, isYouTubeTrailer } from "../../lib/trailer";
import type { HeroTrailer } from "../../lib/types";
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
  // Storage can be ready before the matching catalogue card has arrived.
  // Keep the honest loading state instead of briefly claiming that there is
  // no unfinished viewing during a cold Android start.
  const isHydrating = !model.storageReady || (resume.hasStoredResume && !anime);

  const openHero = () => {
    if (isHydrating) return;
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
      className={`home-cinema-hero ${isHydrating ? "hydrating-resume" : hasResume ? "has-resume" : "empty-resume"}`}
      role={isHydrating ? "status" : "link"}
      tabIndex={isHydrating ? -1 : 0}
      aria-busy={isHydrating}
      aria-label={isHydrating ? "Загружаем сохранённый прогресс" : hasResume ? `Продолжить ${anime?.title}` : "Выбрать аниме"}
      onClick={onHeroClick}
      onKeyDown={onHeroKeyDown}
    >
      <HeroMedia model={model} actions={actions} />
      <div className="home-cinema-vignette" />

      <div className="home-cinema-copy">
        <button type="button" className="eyebrow hero-resume-label" disabled={isHydrating} onClick={openHero}>
          {isHydrating ? "ЗАГРУЖАЕМ СОХРАНЕНИЯ" : hasResume ? "ПРОДОЛЖИТЬ ПРОСМОТР" : "ВЫБРАТЬ ЧТО ПОСМОТРЕТЬ"}
        </button>
        {isHydrating ? (
          <>
            <h1>Возвращаем твой<br /><i>прогресс просмотра.</i></h1>
            <p>Читаем сохранения активного профиля. Это займёт всего несколько секунд.</p>
          </>
        ) : hasResume && anime && state ? (
          <>
            <h1>{anime.title}</h1>
            <p>
              {seasonLabel} · серия {resume.displayEpisode} · остановились на{" "}
              {formatTime(position)}
            </p>
          </>
        ) : (
          <>
            <h1>Твоя коллекция.<br /><i>Твои правила.</i></h1>
            <p>Незавершённого просмотра пока нет — выбери новое аниме в каталоге.</p>
          </>
        )}
        <div className="home-cinema-actions">
          <span className="home-cinema-cta">
            {isHydrating
              ? "Синхронизация…"
              : hasResume
                ? `▶ Продолжить с ${formatTime(position)}`
                : "⌕ Открыть каталог"}
          </span>
        </div>
      </div>
    </section>
  );
}

function HeroMedia({ model, actions }: HomePageProps) {
  const { resume, playerPrefs } = model;
  const { anime, previewAnime, displayEpisode, trailer } = resume;
  const previewEnabled = Boolean(anime && playerPrefs.homeEpisodePreview);
  const fallback = previewAnime?.poster?.fullsize
    ?? previewAnime?.poster?.big
    ?? anime?.poster?.fullsize
    ?? anime?.poster?.big;

  if (previewEnabled && playerPrefs.homePreviewMode === "screenshots" && trailer) {
    return <TrailerMedia trailer={trailer} fallback={fallback} />;
  }

  // A slideshow can eventually mount an episode iframe. On a phone that feels
  // like an empty/broken player when the title has no trailer, so keep the
  // hero honest and lightweight: artwork only.
  if (IS_ANDROID_APP && previewEnabled && playerPrefs.homePreviewMode === "screenshots") {
    return (
      <div className="home-cinema-media home-cinema-mobile-banner" aria-hidden="true">
        {fallback
          ? <img src={fallback} alt="" fetchPriority="high" />
          : <span className="home-cinema-placeholder">AnimeSoul</span>}
      </div>
    );
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
  const lastYoutubeLoopAtRef = useRef(0);
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
      if (playerState === 0) {
        const now = performance.now();
        if (now - lastYoutubeLoopAtRef.current >= 1_200) {
          lastYoutubeLoopAtRef.current = now;
          const target = iframeRef.current?.contentWindow;
          target?.postMessage(JSON.stringify({
            event: "command",
            func: "seekTo",
            args: [startAt, true],
            id: "animesoul-home-trailer",
          }), "*");
          target?.postMessage(JSON.stringify({
            event: "command",
            func: "playVideo",
            args: [],
            id: "animesoul-home-trailer",
          }), "*");
        }
      }
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
  }, [reveal, startAt, trailer.kind, trailer.url]);

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
