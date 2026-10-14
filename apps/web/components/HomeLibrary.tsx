"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  catalogItemsSchema,
  episodeListSchema,
  type Anime,
  type Episode,
} from "@animesoul/contracts";
import { useCardLibrary } from "./CardLibrary";
import { HomeHeroMedia } from "./HomeHeroMedia";
import { HomeRail } from "./HomeRail";
import {
  homeProgressLabel,
  homeResumeHref,
  nextHomeEpisode,
  recentHomeProgress,
} from "../lib/home-viewing";

export function HomeLibrary({
  children,
  featured,
}: {
  children: ReactNode;
  featured: Anime | undefined;
}) {
  const { account, library } = useCardLibrary();
  const recent = recentHomeProgress(library?.progress ?? []);
  const watchingKey = recent.map((item) => item.animeId).join(",");
  const [collection, setCollection] = useState<{
    key: string;
    items: Anime[];
    state: "ready" | "error";
  }>({ key: "", items: [], state: "ready" });
  const [retry, setRetry] = useState(0);
  const [nextCollection, setNextCollection] = useState<{
    key: string;
    episodes: Record<string, Episode>;
  }>({ key: "", episodes: {} });

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
  const completedKey = history
    .filter(({ progress }) => progress.completed && progress.episode?.id)
    .map(({ anime, progress }) => `${anime.slug}:${progress.episode!.id}`)
    .join(",");
  useEffect(() => {
    if (!completedKey) return;
    const controller = new AbortController();
    const completed = history.filter(({ progress }) => progress.completed && progress.episode?.id);
    void Promise.all(
      completed.map(async ({ anime, progress }) => {
        try {
          const response = await fetch(`/api/anime/${anime.slug}/episodes`, {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
          });
          if (!response.ok) return null;
          const { episodes } = episodeListSchema.parse(await response.json());
          const next = nextHomeEpisode(progress, episodes);
          return next ? ([anime.id, next] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!controller.signal.aborted)
        setNextCollection({
          key: completedKey,
          episodes: Object.fromEntries(results.filter((result) => result !== null)),
        });
    });
    return () => controller.abort();
  }, [completedKey]);
  const nextEpisodes = nextCollection.key === completedKey ? nextCollection.episodes : {};
  const watching = history.filter(
    ({ anime, progress }) => !progress.completed || nextEpisodes[anime.id],
  );
  const latest = history[0];
  const current = latest?.anime ?? featured;
  const progress = latest?.progress;
  const next = current ? nextEpisodes[current.id] : undefined;
  const viewing = progress
    ? homeProgressLabel(
        next
          ? {
              ...progress,
              episode: next,
              position: 0,
              duration: next.duration ?? 0,
              completed: false,
            }
          : progress,
      )
    : null;
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
  const loading = Boolean(watchingKey && collection.key !== watchingKey);
  const failed = collection.key === watchingKey && collection.state === "error";

  return (
    <div className="home-page">
      <section className="home-cinema-hero" aria-label={label}>
        <HomeHeroMedia
          key={current?.id ?? "empty"}
          title={current?.title ?? "AnimeSoul"}
          poster={current?.poster ?? null}
          trailers={current?.details?.trailerUrls ?? []}
        />
        <div className="home-cinema-vignette" aria-hidden="true" />
        <Link
          className="home-cinema-link"
          href={continueHref}
          aria-label={current ? `${label}: ${current.title}` : "Открыть каталог аниме"}
        >
          <div className="home-cinema-copy">
            <p className="home-resume-label">{latest ? "С возвращением" : "На вечер"}</p>
            <h1>{current?.title ?? "Найди свою следующую историю"}</h1>
            <p className="home-cinema-description">
              {viewing
                ? `${viewing.episode}. ${viewing.time}.`
                : current
                  ? current.genres.slice(0, 2).join(" / ") +
                    (current.year ? ` · ${current.year}` : "")
                  : "Любимые истории и новые открытия в одном месте."}
            </p>
            <span className="home-cinema-cta">
              <span className="home-play-glyph" aria-hidden="true">
                ▶
              </span>
              {label}
              <span className="home-cta-arrow" aria-hidden="true">
                ↗
              </span>
            </span>
          </div>
        </Link>
      </section>
      <div className="home-library-workspace">
        <section className="home-watching" aria-labelledby="home-watching-title">
          <div className="home-library-heading">
            <div>
              <h2 id="home-watching-title">Смотрю сейчас</h2>
              <p>Вернись к истории с того места, где остановился.</p>
            </div>
            {account && (
              <Link className="home-section-link" href="/library">
                Моя библиотека <span aria-hidden="true">↗</span>
              </Link>
            )}
          </div>
          {loading ? (
            <div className="home-watching-rail" aria-label="Загрузка просмотров" aria-busy="true">
              {Array.from({ length: Math.min(recent.length, 4) }, (_, index) => (
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
            <HomeRail label="Смотрю сейчас" variant="watching">
              {watching.map(({ anime, progress: item }) => {
                const following = nextEpisodes[anime.id];
                const info = homeProgressLabel(
                  following
                    ? {
                        ...item,
                        episode: following,
                        position: 0,
                        duration: following.duration ?? 0,
                        completed: false,
                      }
                    : item,
                );
                return (
                  <Link
                    className="home-watch-card"
                    key={anime.id}
                    href={homeResumeHref(anime, item, following)}
                    aria-label={`Продолжить: ${anime.title}. ${info.episode}. ${info.time}`}
                  >
                    <div className="home-watch-image">
                      {anime.poster && (
                        <img src={anime.poster} alt="" width={480} height={270} loading="lazy" />
                      )}
                      <span className="home-watch-play" aria-hidden="true">
                        ▶
                      </span>
                      <span className="home-watch-time">{info.time}</span>
                      <progress
                        max={100}
                        value={info.percent}
                        aria-label={`Прогресс: ${anime.title}`}
                      />
                    </div>
                    <h3>{anime.title}</h3>
                    <p>{info.episode}</p>
                  </Link>
                );
              })}
            </HomeRail>
          ) : (
            <div className="home-watching-empty">
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
