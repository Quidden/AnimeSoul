"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  catalogItemsSchema,
  episodeHref,
  episodeListSchema,
  type Anime,
  type Episode,
} from "@animesoul/contracts";
import { useCardLibrary } from "./CardLibrary";
import { HomeHeroMedia } from "./HomeHeroMedia";
import { PosterAmbient } from "./PosterAmbient";
import { Icon } from "./Icon";
import {
  homeProgressLabel,
  homeResumeHref,
  nextHomeEpisode,
  recentHomeProgress,
  type HomeProgress,
} from "../lib/home-viewing";
import { episodeStrip, stripLabel, type StripSegment } from "../lib/home-strip";
import { formatLabels } from "../lib/catalog-filters";
import { ratingNumber } from "../lib/ratings";

const shelfSize = 4;

export function HomeLibrary({
  children,
  featured,
}: {
  children: ReactNode;
  featured: Anime | undefined;
}) {
  const { account, library, ready } = useCardLibrary();
  const recent = recentHomeProgress(library?.progress ?? []);
  const watchingKey = recent.map((item) => item.animeId).join(",");
  const [collection, setCollection] = useState<{
    key: string;
    items: Anime[];
    state: "ready" | "error";
  }>({ key: "", items: [], state: "ready" });
  const [retry, setRetry] = useState(0);
  const [episodeCollection, setEpisodeCollection] = useState<{
    key: string;
    episodes: Record<string, Episode[]>;
  }>({ key: "", episodes: {} });
  const [muted, setMuted] = useState(true);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const onPlayingChange = useCallback((playing: boolean) => setTrailerPlaying(playing), []);

  useEffect(() => {
    if (!watchingKey) return;
    const controller = new AbortController();
    void fetch("/api/catalog/by-ids?ids=" + watchingKey, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("History unavailable");
        const { items } = catalogItemsSchema.parse(await response.json());
        if (!controller.signal.aborted) setCollection({ key: watchingKey, items, state: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCollection({ key: watchingKey, items: [], state: "error" });
      });
    return () => controller.abort();
  }, [watchingKey, retry]);

  const items = collection.key === watchingKey ? collection.items : [];
  const history = recent.flatMap((progress) => {
    const anime = items.find((item) => item.id === progress.animeId);
    return anime ? [{ anime, progress }] : [];
  });
  const shelfKey = history
    .slice(0, shelfSize)
    .map(({ anime }) => anime.slug)
    .join(",");
  // Episode lists drive both the next-episode link and the per-season strip on each card.
  useEffect(() => {
    if (!shelfKey) return;
    const controller = new AbortController();
    void Promise.all(
      shelfKey.split(",").map(async (slug) => {
        try {
          const response = await fetch(`/api/anime/${slug}/episodes`, {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
          });
          if (!response.ok) return null;
          const { episodes } = episodeListSchema.parse(await response.json());
          return [slug, episodes] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!controller.signal.aborted)
        setEpisodeCollection({
          key: shelfKey,
          episodes: Object.fromEntries(results.filter((result) => result !== null)),
        });
    });
    return () => controller.abort();
  }, [shelfKey]);
  const episodesBySlug = episodeCollection.key === shelfKey ? episodeCollection.episodes : {};
  const nextFor = (anime: Anime, progress: HomeProgress) =>
    episodesBySlug[anime.slug] ? nextHomeEpisode(progress, episodesBySlug[anime.slug]!) : undefined;
  const watching = history
    .filter(({ anime, progress }) => !progress.completed || nextFor(anime, progress))
    .slice(0, shelfSize);
  const latest = history[0];
  const current = latest?.anime ?? featured;
  const progress = latest?.progress;
  const next = current && progress ? nextFor(current, progress) : undefined;
  const viewing = progress ? homeProgressLabel(resumeState(progress, next)) : null;
  const continueHref = current ? homeResumeHref(current, progress, next) : "/catalog";
  const label = latest
    ? next
      ? "Следующая серия"
      : progress?.completed
        ? "Открыть аниме"
        : "Продолжить просмотр"
    : current
      ? "Смотреть аниме"
      : "Открыть каталог";
  const screenshots = current?.details?.screenshots ?? [];
  const source = latest ? "Вы смотрите это аниме" : "Популярно сейчас";
  const media = trailerPlaying ? "трейлер" : screenshots.length ? "кадры из серий" : "";
  const loading = Boolean(watchingKey && collection.key !== watchingKey);
  const failed = collection.key === watchingKey && collection.state === "error";

  return (
    <div className="home-page">
      <PosterAmbient poster={current?.poster ?? null} />
      <section className="home-cinema-hero" aria-label={label} data-compass="Главное">
        <HomeHeroMedia
          key={current?.id ?? "empty"}
          title={current?.title ?? "AnimeSoul"}
          poster={current?.poster ?? null}
          trailers={current?.details?.trailerUrls ?? []}
          screenshots={screenshots}
          muted={muted}
          onPlayingChange={onPlayingChange}
        />
        <div className="home-cinema-vignette" aria-hidden="true" />
        <Link
          className="home-cinema-link"
          href={continueHref}
          aria-label={current ? `${label}: ${current.title}` : "Открыть каталог аниме"}
        >
          <div className="home-cinema-copy">
            <p className="home-resume-label">
              <i aria-hidden="true" />
              {current ? source : "На вечер"}
              {media && ` · ${media}`}
            </p>
            <h1>{current?.title ?? "Найди свою следующую историю"}</h1>
            {current && (
              <p className="home-cinema-meta">
                {[
                  current.year || null,
                  formatLabels[current.format ?? "unknown"],
                  current.details?.studios?.[0],
                  current.genres.slice(0, 2).join(", ") || null,
                  current.shikimoriScore ? `★ ${ratingNumber(current.shikimoriScore)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <p className="home-cinema-description">
              {current?.description || "Любимые истории и новые открытия в одном месте."}
            </p>
            {viewing && (
              <p className="home-cinema-progress">
                <span aria-hidden="true">
                  <i style={{ width: `${viewing.percent}%` }} />
                </span>
                {viewing.episode} · {viewing.time}
              </p>
            )}
            <span className="home-cinema-cta">
              <span className="home-play-glyph" aria-hidden="true">
                ▶
              </span>
              {label}
            </span>
          </div>
        </Link>
        {trailerPlaying && (
          <button
            type="button"
            className="home-cinema-sound"
            aria-pressed={!muted}
            aria-label={muted ? "Включить звук трейлера" : "Выключить звук трейлера"}
            onClick={() => setMuted((value) => !value)}
          >
            <Icon name={muted ? "volume-off" : "volume"} />
          </button>
        )}
      </section>
      <div className="home-library-workspace">
        <section
          className="home-watching"
          aria-labelledby="home-watching-title"
          data-compass={account ? "Продолжить" : "Моя полка"}
        >
          <div className="home-library-heading">
            <div>
              <h2 id="home-watching-title">{account ? "Продолжить" : "Моя полка"}</h2>
              <p>
                {account
                  ? "Вернись к истории с того места, где остановился."
                  : "Начатые аниме появятся здесь, когда ты войдёшь."}
              </p>
            </div>
            {account && (
              <Link className="home-section-link" href="/library">
                Моя библиотека <span aria-hidden="true">↗</span>
              </Link>
            )}
          </div>
          {loading ? (
            <div className="home-watch-grid" aria-label="Загрузка просмотров" aria-busy="true">
              {Array.from({ length: Math.min(recent.length, shelfSize) }, (_, index) => (
                <div className="home-watch-skeleton" key={index} />
              ))}
            </div>
          ) : failed ? (
            <div className="home-watching-empty" role="status">
              <p>Не удалось загрузить последние просмотры.</p>
              <button
                className="home-section-link"
                type="button"
                onClick={() => {
                  setCollection({ key: "", items: [], state: "ready" });
                  setRetry((value) => value + 1);
                }}
              >
                Попробовать снова ↗
              </button>
            </div>
          ) : watching.length ? (
            <div className="home-watch-grid">
              {watching.map(({ anime, progress: item }) => (
                <HomeWatchCard
                  key={anime.id}
                  anime={anime}
                  progress={item}
                  all={library?.progress ?? []}
                  episodes={episodesBySlug[anime.slug]}
                  next={nextFor(anime, item)}
                />
              ))}
            </div>
          ) : (
            <div
              className="home-watching-empty"
              style={ready ? undefined : { visibility: "hidden" }}
            >
              <span className="home-empty-play" aria-hidden="true">
                ▶
              </span>
              <div>
                <h3>
                  {account
                    ? history.length
                      ? "Самое время для новой истории"
                      : "Здесь будут твои просмотры"
                    : "Твои истории всегда под рукой"}
                </h3>
                <p>
                  {account
                    ? history.length
                      ? "Текущие серии досмотрены. Выбери, что смотреть дальше."
                      : "Начни смотреть аниме. Мы запомним серию и время."
                    : "Войди, чтобы сохранять прогресс и продолжать с любого устройства."}
                </p>
              </div>
              <Link className="home-section-link" href={account ? "/catalog" : "/account"}>
                {account ? "Выбрать аниме" : "Войти в аккаунт"} <span aria-hidden="true">↗</span>
              </Link>
            </div>
          )}
        </section>
        {children}
      </div>
    </div>
  );
}

function resumeState(progress: HomeProgress, next: Episode | undefined): HomeProgress {
  return next
    ? {
        ...progress,
        episode: next,
        position: 0,
        duration: next.duration ?? 0,
        completed: false,
      }
    : progress;
}

function HomeWatchCard({
  anime,
  progress,
  all,
  episodes,
  next,
}: {
  anime: Anime;
  progress: HomeProgress;
  all: HomeProgress[];
  episodes: Episode[] | undefined;
  next: Episode | undefined;
}) {
  const info = homeProgressLabel(resumeState(progress, next));
  const strip = episodes ? episodeStrip(progress, all, episodes, anime.details?.episodesTotal) : [];
  const released = strip.filter((segment) => segment.state !== "upcoming").length;
  return (
    <article className="home-watch-card">
      <Link
        className="home-watch-poster"
        href={homeResumeHref(anime, progress, next)}
        aria-label={`${next ? "Смотреть следующую серию" : "Продолжить"}: ${anime.title}. ${info.episode}. ${info.time}`}
      >
        {anime.poster ? (
          <img src={anime.poster} alt="" width={168} height={252} loading="lazy" />
        ) : (
          <span className="home-watch-poster-empty" />
        )}
        <span className="home-watch-play" aria-hidden="true">
          ▶
        </span>
      </Link>
      <div className="home-watch-body">
        <h3>
          <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
        </h3>
        <p className={next ? "is-next" : undefined}>
          {next ? `Вышла следующая серия · ${info.episode}` : `${info.episode} · ${info.time}`}
        </p>
        {strip.length ? (
          <>
            <EpisodeStrip slug={anime.slug} segments={strip} />
            <p className="home-strip-legend">
              <span>1</span>
              <span>
                {released < strip.length
                  ? `вышло ${released} из ${strip.length}`
                  : `${strip.length} ${plural(strip.length)}`}
              </span>
            </p>
          </>
        ) : (
          <span className="home-watch-line" aria-hidden="true">
            <i style={{ width: `${info.percent}%` }} />
          </span>
        )}
      </div>
    </article>
  );
}

// A pointer shortcut to any episode of the season; the card's own links stay the keyboard path.
function EpisodeStrip({ slug, segments }: { slug: string; segments: StripSegment[] }) {
  return (
    <div className="home-strip" aria-hidden="true">
      {segments.map((segment) =>
        segment.episodeId ? (
          <Link
            key={segment.number}
            href={episodeHref(slug, segment.episodeId)}
            tabIndex={-1}
            className={`home-strip-ep is-${segment.state}`}
            data-label={stripLabel(segment)}
            style={
              segment.state === "current"
                ? ({ "--progress": `${segment.percent}%` } as CSSProperties)
                : undefined
            }
          />
        ) : (
          <span
            key={segment.number}
            className="home-strip-ep is-upcoming"
            data-label={stripLabel(segment)}
          />
        ),
      )}
    </div>
  );
}

function plural(count: number) {
  const last = count % 10,
    tens = count % 100;
  if (last === 1 && tens !== 11) return "серия";
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "серии";
  return "серий";
}
