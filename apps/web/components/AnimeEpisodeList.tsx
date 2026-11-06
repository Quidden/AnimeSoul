"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  onEpisodeChange,
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
  onEpisodeChange?: (episode: Episode) => void;
  durationMinutes?: number | undefined;
  airedAt?: string | undefined;
  nextEpisodeAt?: string | undefined;
  totalEpisodes?: number | undefined;
}) {
  const [episodes, setEpisodes] = useState(initial),
    [notice, setNotice] = useState(""),
    [localSeason, setLocalSeason] = useState(
      (initial.find((episode) => episode.season !== "0") ?? initial[0])?.season ?? "",
    );
  const [episodeQuery, setEpisodeQuery] = useState("");
  const { account, library, refresh } = useCardLibrary();
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(5);
  const [page, setPage] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [marking, setMarking] = useState(false);
  const [offer, setOffer] = useState<Episode[]>([]);
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
  const activeSeason = seasons.includes(requestedSeason)
    ? requestedSeason
    : (seasons.find((value) => value !== "0") ?? seasons[0] ?? "");
  const visibleEpisodes = episodes.filter((episode) => episode.season === activeSeason);
  const query = episodeQuery.trim().replace(",", ".");
  const foundEpisodes = visibleEpisodes.filter(
    (episode) => !query || Number(episode.number) === Number(query),
  );
  useEffect(() => setEpisodeQuery(""), [animeId, activeSeason]);
  useEffect(() => {
    setPage(null);
    setExpanded(false);
    setOffer([]);
  }, [animeId, activeSeason]);
  // One row of cards by default; the row width decides how many fit.
  useEffect(() => {
    const node = grid.current;
    if (!node) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(node).columnGap) || 12;
      setColumns(Math.max(2, Math.floor((node.clientWidth + gap) / (200 + gap))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [activeSeason]);
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
  // The row opens on the selected episode, otherwise on the first one not watched yet.
  const pageCount = Math.max(1, Math.ceil(foundEpisodes.length / columns));
  const selectedIndex = foundEpisodes.findIndex((e) => e.id === selectedEpisodeId);
  const firstOpen = foundEpisodes.findIndex((e) => !saved(e)?.completed);
  const startPage = Math.floor(
    Math.max(0, selectedIndex >= 0 ? selectedIndex : firstOpen) / columns,
  );
  const currentPage = Math.min(pageCount - 1, page ?? startPage);
  const showAll = expanded || Boolean(query) || foundEpisodes.length <= columns;
  useEffect(() => setPage(null), [selectedEpisodeId]);
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
  // Marks use the same progress endpoint as the library; the library item keeps its dubbing.
  async function mark(list: Episode[], completed: boolean) {
    if (!account || !list.length) return;
    setMarking(true);
    setOffer([]);
    try {
      for (const episode of list) {
        const previous = saved(episode);
        const duration =
          Math.round(
            episode.duration ?? previous?.duration ?? (durationMinutes ? durationMinutes * 60 : 0),
          ) || 1440;
        if (previous) {
          await accountRequest(
            "/api/account/progress",
            {
              animeId,
              episodeKey: previous.episodeKey,
              // Unmarking means "not watched": it must not leave a finished position behind.
              position: completed ? duration : 0,
              duration,
              completed,
              dubbing: item?.dubbing ?? "",
              season: item?.season ?? Math.max(1, Number.parseInt(episode.season, 10) || 1),
            },
            account.csrfToken,
          );
        } else if (completed) {
          // A first mark goes through a playback session, like the player: only then the
          // progress is bound to the episode, so the home page and alerts can find it.
          const { sessionId } = (await accountRequest(
            "/api/account/playback/session",
            { episodeId: episode.id },
            account.csrfToken,
          )) as { sessionId: string };
          await accountRequest(
            "/api/account/playback/progress",
            {
              sessionId,
              sequence: 1,
              position: duration,
              duration,
              watchedDelta: 0,
              completed: true,
              dubbing: item?.dubbing ?? "",
            },
            account.csrfToken,
          );
        }
      }
      await refresh();
      setNotice(
        list.length === 1
          ? `Серия ${list[0]!.number} ${completed ? "отмечена просмотренной" : "больше не отмечена"}.`
          : completed
            ? `Отмечено просмотренными: ${list.length}.`
            : `Отметки сняты: ${list.length}.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить отметку.");
    } finally {
      setMarking(false);
    }
  }
  async function toggleWatched(episode: Episode) {
    const completed = !saved(episode)?.completed;
    await mark([episode], completed);
    if (!completed) return;
    const index = visibleEpisodes.indexOf(episode);
    const gaps = visibleEpisodes.slice(0, index).filter((e) => !saved(e)?.completed);
    setOffer(gaps);
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
      <label className="anime-episode-search">
        <span>Найти серию</span>
        <input
          type="search"
          inputMode="numeric"
          placeholder="Номер серии"
          value={episodeQuery}
          onChange={(event) => setEpisodeQuery(event.target.value)}
        />
      </label>
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
            {account && visibleEpisodes.length > 0 && (
              <button
                className="anime-mark-all"
                type="button"
                disabled={marking}
                onClick={() =>
                  void (remainingEpisodes === 0
                    ? mark(visibleEpisodes, false)
                    : mark(
                        visibleEpisodes.filter((e) => !saved(e)?.completed),
                        true,
                      ))
                }
              >
                {remainingEpisodes === 0 ? "Снять все отметки" : "Отметить всё просмотренным"}
              </button>
            )}
          </div>
          {offer.length > 0 && (
            <p className="anime-mark-offer" role="status">
              <span>Отметить и пропущенные серии до этой?</span>
              <button
                className="primary"
                type="button"
                disabled={marking}
                onClick={() => void mark(offer, true)}
              >
                {offer.length === 1
                  ? `Отметить серию ${offer[0]!.number}`
                  : `Отметить ${offer[0]!.number}–${offer.at(-1)!.number}`}
              </button>
              <button className="outline" type="button" onClick={() => setOffer([])}>
                Не нужно
              </button>
            </p>
          )}
          {!query && foundEpisodes.length > columns && (
            <div className="anime-episode-pager">
              {!expanded && (
                <span className="anime-episode-range">
                  <button
                    type="button"
                    aria-label="Предыдущие серии"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    ‹
                  </button>
                  <span>
                    {foundEpisodes[currentPage * columns]?.number}–
                    {
                      foundEpisodes[Math.min(foundEpisodes.length, (currentPage + 1) * columns) - 1]
                        ?.number
                    }{" "}
                    из {foundEpisodes.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Следующие серии"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    ›
                  </button>
                </span>
              )}
              <button
                className="anime-episode-toggle"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Свернуть" : `Все серии · ${foundEpisodes.length}`}
              </button>
            </div>
          )}
          <div className="anime-episode-grid" ref={grid}>
            {foundEpisodes.map((e, index) => {
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
                  hidden={!showAll && Math.floor(index / columns) !== currentPage}
                >
                  <Link
                    href={episodeHref(slug, e.id) + "#anime-watch"}
                    aria-current={e.id === selectedEpisodeId ? "page" : undefined}
                    scroll={false}
                    prefetch={false}
                    onNavigate={(event) => {
                      if (!onEpisodeChange) return;
                      event.preventDefault();
                      onEpisodeChange(e);
                    }}
                  >
                    <span className="anime-episode-number" aria-hidden="true">
                      {e.number}
                    </span>
                    <span className="anime-episode-heading">
                      <strong>Серия {e.number}</strong>
                      <span aria-hidden="true">{e.id === selectedEpisodeId ? "▶" : ""}</span>
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
                  {account && (
                    <button
                      className="anime-episode-check"
                      type="button"
                      aria-pressed={watched}
                      disabled={marking}
                      aria-label={`${watched ? "Снять отметку" : "Отметить просмотренной"}: серия ${e.number}`}
                      title={watched ? "Снять отметку" : "Отметить просмотренной"}
                      onClick={() => void toggleWatched(e)}
                    >
                      <span aria-hidden="true">✓</span>
                    </button>
                  )}
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
          {query && !foundEpisodes.length && (
            <p className="anime-episodes-empty" role="status">
              Серия {episodeQuery.trim()} пока недоступна в этом сезоне.
            </p>
          )}
        </div>
      )}
      {!episodes.length && (
        <p className="anime-episodes-empty">Серии появятся здесь, когда будут доступны.</p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
