"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { episodeHref, episodeListSchema, type Episode } from "@animesoul/contracts";
import { useCardLibrary } from "./CardLibrary";
import { accountRequest } from "../lib/account-client";
import { episodeViewing, minutesLabel } from "../lib/episode-view";
import { RatingSlider } from "./RatingSlider";
export function AnimeEpisodeList({
  slug,
  animeId,
  initial,
  selectedSeason,
  selectedEpisodeId,
  onSeasonChange,
  durationMinutes,
  airedAt,
  nextEpisodeAt,
  totalEpisodes,
}: {
  slug: string;
  animeId: string;
  initial: Episode[];
  selectedSeason?: string;
  selectedEpisodeId?: string;
  onSeasonChange?: (season: string) => void;
  durationMinutes?: number | undefined;
  airedAt?: string | undefined;
  nextEpisodeAt?: string | undefined;
  totalEpisodes?: number | undefined;
}) {
  const [episodes, setEpisodes] = useState(initial),
    [notice, setNotice] = useState(""),
    [localSeason, setLocalSeason] = useState(initial[0]?.season ?? "");
  const { account, library, refresh } = useCardLibrary();
  useEffect(() => setEpisodes(initial), [initial]);
  useEffect(() => {
    const controller = new AbortController();
    const update = () => {
      void fetch("/api/anime/" + encodeURIComponent(slug) + "/episodes", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (r) => {
          if (r.ok) setEpisodes(episodeListSchema.parse(await r.json()).episodes);
        })
        .catch(() => {});
    };
    window.addEventListener("animesoul:episodes-updated", update);
    return () => {
      controller.abort();
      window.removeEventListener("animesoul:episodes-updated", update);
    };
  }, [slug]);
  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) =>
    a.localeCompare(b, "ru", { numeric: true }),
  );
  const requestedSeason = selectedSeason ?? localSeason;
  const activeSeason = seasons.includes(requestedSeason) ? requestedSeason : (seasons[0] ?? "");
  const visibleEpisodes = episodes.filter((episode) => episode.season === activeSeason);
  const item = library?.items.find((i) => i.animeId === animeId);
  const saved = (episode: Episode) =>
    library?.progress.find(
      (p) =>
        p.animeId === animeId &&
        (p.episode?.id === episode.id || p.episodeKey === "episode:" + episode.id),
    );
  const watchedCount = visibleEpisodes.filter((e) => saved(e)?.completed).length;
  const remainingEpisodes = visibleEpisodes.length - watchedCount;
  const remainingTimes = visibleEpisodes.map(
    (e) =>
      episodeViewing(e.duration ?? (durationMinutes ? durationMinutes * 60 : null), saved(e))
        .remaining,
  );
  const remainingTime = remainingTimes.every((value) => value !== null)
    ? remainingTimes.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  async function score(scope: "season" | "episode", key: string, value: number | null) {
    if (!account) return;
    try {
      await accountRequest(
        "/api/account/ratings",
        { animeId, scope, key, score: value },
        account.csrfToken,
      );
      await refresh();
      setNotice("Оценка сохранена.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить оценку.");
      throw e;
    }
  }
  function picker(scope: "season" | "episode", key: string, label: string) {
    return account ? (
      <RatingSlider
        label={label}
        value={item?.ratings.find((r) => r.scope === scope && r.key === key)?.score ?? null}
        onSave={(value) => score(scope, key, value)}
      />
    ) : null;
  }
  return (
    <section className="anime-episodes">
      <div className="catalog-shelf-heading">
        <h2>Серии</h2>
        <span>
          {visibleEpisodes.length
            ? `${visibleEpisodes.length} доступно`
            : "Список появится после загрузки плеера"}
        </span>
      </div>
      <div className="anime-viewing-summary">
        <div>
          <strong>
            {account ? `${watchedCount} / ${visibleEpisodes.length}` : visibleEpisodes.length}
          </strong>
          <span>{account ? "серий просмотрено" : "серий доступно"}</span>
        </div>
        <p>
          {account
            ? `${remainingEpisodes} осталось посмотреть`
            : "Войдите, чтобы видеть свой прогресс"}
          {account && remainingTime !== null && remainingTime > 0 && (
            <span>
              {" "}
              · около{" "}
              {Math.floor(remainingTime / 3600) > 0 ? `${Math.floor(remainingTime / 3600)} ч ` : ""}
              {Math.ceil((remainingTime % 3600) / 60)} мин
            </span>
          )}
          {!!totalEpisodes && totalEpisodes > episodes.length && (
            <span> · ещё {totalEpisodes - episodes.length} ожидается</span>
          )}
        </p>
        <div
          className="anime-viewing-bar"
          role="progressbar"
          aria-label="Просмотр сезона"
          aria-valuenow={watchedCount}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, visibleEpisodes.length)}
        >
          <i
            style={{
              width: `${visibleEpisodes.length ? (watchedCount / visibleEpisodes.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      {(airedAt || nextEpisodeAt) && (
        <p className="anime-episode-release-note">
          {airedAt && (
            <>
              Премьера тайтла:{" "}
              <time dateTime={airedAt}>{new Date(airedAt).toLocaleDateString("ru-RU")}</time>
            </>
          )}
          {nextEpisodeAt && (
            <>
              {" "}
              · Следующая серия:{" "}
              <time dateTime={nextEpisodeAt}>
                {new Date(nextEpisodeAt).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}
              </time>
            </>
          )}
        </p>
      )}
      {seasons.length > 1 && (
        <div className="anime-internal-seasons" aria-label="Сезоны текущего тайтла">
          {seasons.map((season) => (
            <button
              className="outline"
              key={season}
              type="button"
              aria-pressed={season === activeSeason}
              onClick={() => {
                setLocalSeason(season);
                onSeasonChange?.(season);
              }}
            >
              {season === "0" ? "Спецвыпуски" : `Сезон ${season}`}
            </button>
          ))}
        </div>
      )}
      {activeSeason && (
        <div className="anime-season" data-season={activeSeason}>
          <div className="anime-season-rating">
            <span>Оценка сезона</span>
            {picker("season", activeSeason, "Оценить сезон")}
          </div>
          <div className="anime-episode-grid">
            {visibleEpisodes.map((e) => {
              const savedProgress = saved(e);
              const duration = e.duration ?? (durationMinutes ? durationMinutes * 60 : null);
              const {
                completed: watched,
                percent,
                started,
                remaining,
              } = episodeViewing(duration, savedProgress);
              return (
                <div
                  className={`anime-episode-tile${watched ? " completed" : ""}${e.id === selectedEpisodeId ? " selected" : ""}`}
                  key={e.id}
                >
                  <Link
                    href={episodeHref(slug, e.id) + "#anime-watch"}
                    aria-current={e.id === selectedEpisodeId ? "page" : undefined}
                    scroll={false}
                    prefetch={false}
                  >
                    <span className="anime-episode-heading">
                      <strong>Серия {e.number}</strong>
                      <span aria-hidden="true">
                        {watched ? "✓" : e.id === selectedEpisodeId ? "▶" : "▷"}
                      </span>
                    </span>
                    <span className="anime-episode-status">
                      {watched
                        ? "Просмотрено"
                        : started
                          ? "Не досмотрено"
                          : account
                            ? "Ещё не смотрели"
                            : "Готова к просмотру"}
                    </span>
                    <span className="anime-episode-duration">
                      {watched
                        ? "До конца"
                        : remaining !== null
                          ? `${started ? "Осталось " : e.duration ? "" : "≈ "}${minutesLabel(remaining)}`
                          : "Длительность уточняется"}
                    </span>
                  </Link>
                  {percent > 0 && (
                    <progress
                      max={100}
                      value={percent}
                      aria-label={`Прогресс серии ${e.number}`}
                      aria-valuetext={watched ? "Просмотрено" : `${Math.round(percent)}%`}
                    />
                  )}
                  {picker("episode", "episode:" + e.id, `Оценить серию ${e.number}`)}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!episodes.length && (
        <p className="anime-episodes-empty">Серии появятся здесь, когда будут доступны.</p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
