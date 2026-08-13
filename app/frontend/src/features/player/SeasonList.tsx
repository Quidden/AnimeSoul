import { EpisodeHoverPreview } from "../../components/EpisodeHoverPreview";
import { episodePreviewImages } from "../../components/EpisodeSlideshow";
import { ScorePicker } from "../../components/ScorePicker";
import { formatRating, seasonCombinedAverage, seasonEpisodeAverage } from "../../lib/ratings";
import {
  episodeDuration,
  formatCalendarDate,
  formatDuration,
  formatTime,
  isEpisodeWatched,
  releaseStatus,
} from "../../lib/anime";
import type { Anime, AnimeProgress, AnimeUserRatings, CommunityAnimeRating, ScheduleEntry, SeasonGroup, Video } from "../../lib/types";

interface SeasonListProps {
  seasons: SeasonGroup[];
  seasonVideos: Record<number, Video[]>;
  saved?: AnimeProgress;
  ratings?: AnimeUserRatings;
  communityRating?: CommunityAnimeRating;
  schedule: Record<number, ScheduleEntry>;
  collapsedSeasons: number[];
  selectedSeason: number;
  selectedEpisode: string;
  previewAnimeById: Record<number, Anime>;
  episodeHoverPreview: boolean;
  newEpisodeKeys: Set<string>;
  onToggleSeason: (season: number) => void;
  onToggleSeasonWatched: (season: number, episodes: string[], videos: Video[]) => void;
  onChooseEpisode: (episode: string, season: number) => void;
  onToggleWatched: (season: number, episode: string, duration: number, video?: Video) => void;
  onSeasonRatingChange: (season: number, value: number | undefined) => void;
  onEpisodeRatingChange: (season: number, episode: string, value: number | undefined) => void;
}

/**
 * Renders franchise seasons and their episode cards.
 *
 * Progress mutation stays in Player.tsx. Keeping this component presentational
 * makes it safe to change the layout without touching playback state.
 */
export function SeasonList({
  seasons,
  seasonVideos,
  saved,
  ratings,
  communityRating,
  schedule,
  collapsedSeasons,
  selectedSeason,
  selectedEpisode,
  previewAnimeById,
  episodeHoverPreview,
  newEpisodeKeys,
  onToggleSeason,
  onToggleSeasonWatched,
  onChooseEpisode,
  onToggleWatched,
  onSeasonRatingChange,
  onEpisodeRatingChange,
}: SeasonListProps) {
  return (
    <div className="all-seasons">
      {seasons.map((group) => {
        const videos = seasonVideos[group.number] ?? [];
        const episodeNumbers = Array.from(new Set(videos.map((video) => video.number))).sort(
          (left, right) => Number(left) - Number(right),
        );
        const watchedCount = episodeNumbers.filter((number) =>
          isEpisodeWatched(saved?.episodes[`${group.number}:${number}`]),
        ).length;
        const allWatched = episodeNumbers.length > 0 && watchedCount === episodeNumbers.length;
        const entry = group.entries[0];
        const status = releaseStatus(entry);
        const scheduleItem = group.entries
          .map((item) => schedule[item.anime_id])
          .find(Boolean);
        const nextDate = scheduleItem?.episodes?.next_date;
        const collapsed = collapsedSeasons.includes(group.number);
        const emptyMessage =
          status.kind === "planned"
            ? `Запланировано${entry.year ? ` · ${entry.year}` : ""}`
            : status.kind === "airing"
              ? nextDate
                ? `Следующая серия · ${formatCalendarDate(nextDate)}`
                : "Сейчас выходит · дата следующей серии не указана"
              : "Видео пока не добавлено";
        const seasonLabel = group.label ?? `Сезон ${group.number}`;

        return (
          <section
            className={`season-panel ${collapsed ? "collapsed " : ""}${group.kind === "special" ? "extra-panel" : ""}`.trim()}
            key={group.number}
          >
            <div className="season-summary-row">
              <button
                type="button"
                className="season-summary"
                onClick={() => onToggleSeason(group.number)}
                aria-expanded={!collapsed}
              >
                <h2>{seasonLabel}</h2>
                <span>{watchedCount} из {episodeNumbers.length} просмотрено</span>
                <b>{collapsed ? "⌄" : "⌃"}</b>
              </button>
              <div className="season-rating-summary">
                {communityRating?.seasons[String(group.number)] && (
                  <span title={`${communityRating.seasons[String(group.number)].count} общих оценок сезона`}>
                    AnimeSoul <b>{formatRating(communityRating.seasons[String(group.number)].average)}</b>
                  </span>
                )}
                <span title="Средняя оценка серий">Серии <b>{formatRating(seasonEpisodeAverage(ratings, group.number))}</b></span>
                <span title="Итог сезона: ручная оценка и средняя серий">Итог <b>{formatRating(seasonCombinedAverage(ratings, group.number))}</b></span>
                <ScorePicker
                  compact
                  value={ratings?.seasons[String(group.number)]}
                  label={`Оценка: ${seasonLabel}`}
                  onChange={value => onSeasonRatingChange(group.number, value)}
                />
              </div>
              <button
                type="button"
                className={`season-watch-toggle ${allWatched ? "active" : ""}`}
                disabled={!episodeNumbers.length}
                aria-label={allWatched
                  ? `Снять отметку «просмотрено» со всех серий: ${seasonLabel}`
                  : `Отметить все серии просмотренными: ${seasonLabel}`}
                title={allWatched
                  ? "Снять отметку со всего сезона"
                  : "Отметить весь сезон просмотренным и учесть длительность серий в статистике"}
                onClick={() => onToggleSeasonWatched(group.number, episodeNumbers, videos)}
              >
                <span className="eye-glyph" />
              </button>
            </div>

            <div className="season-progress">
              <i style={{ width: `${episodeNumbers.length ? watchedCount / episodeNumbers.length * 100 : 0}%` }} />
            </div>

            <div className="season-content">
              <div>
                {!episodeNumbers.length && (
                  <div className={`release-empty ${status.kind === "planned" ? "planned" : status.kind === "airing" ? "airing" : ""}`}>
                    <i />
                    {emptyMessage}
                  </div>
                )}
                <div className="episode-grid">
                  {episodeNumbers.map((number) => {
                    const key = `${group.number}:${number}`;
                    const progress = saved?.episodes[key];
                    const watched = isEpisodeWatched(progress);
                    const active = group.number === selectedSeason && number === selectedEpisode;
                    const isNew = newEpisodeKeys.has(key) && !watched;
                    const duration = episodeDuration(videos, number);
                    const video = videos.find((item) => item.number === number);
                    const originEntry = group.entries.find((item) => item.anime_id === video?.originAnimeId) ?? entry;
                    const previewAnime = previewAnimeById[originEntry.anime_id] ?? originEntry;
                    const unit = video?.contentKind ?? (group.kind === "movie" ? "Фильм" : "Серия");

                    return (
                      <EpisodeHoverPreview
                        key={number}
                        enabled={episodeHoverPreview}
                        images={episodePreviewImages(previewAnime, video?.originNumber ?? number)}
                        fallback={previewAnime.poster?.fullsize ?? previewAnime.poster?.big}
                        label={`${seasonLabel} · ${unit} ${number}`}
                      >
                        <div className="episode-card-shell">
                          <button
                            className={`episode-entry ${active ? "active " : ""}${watched ? "watched " : ""}${isNew ? "new-episode " : ""}${unit !== "Серия" && unit !== "Фильм" ? "extra-episode" : ""}`.trim()}
                            onClick={() => onChooseEpisode(number, group.number)}
                          >
                            <b>{number}{watched && <i>✓</i>}</b>
                            <span>
                              {unit} {number}
                              {isNew && <em>НОВАЯ</em>}
                              {(progress?.completions ?? 0) > 1 && (
                                <em className="rewatch-count">×{progress?.completions}</em>
                              )}
                              <small>
                                {duration ? formatDuration(duration) : "Длительность неизвестна"} · {watched
                                  ? "Просмотрено"
                                  : `${progress?.percent ?? 0}% · ${formatTime(progress?.position ?? 0)}`}
                                {communityRating?.episodes[key]
                                  ? ` · AnimeSoul ${formatRating(communityRating.episodes[key].average)}`
                                  : ""}
                              </small>
                            </span>
                          </button>
                          <button
                            type="button"
                            className={`episode-watch-toggle ${watched ? "active" : ""}`}
                            aria-label={watched
                              ? `Снять отметку «просмотрено» с ${unit.toLowerCase()} ${number}`
                              : `Отметить ${unit.toLowerCase()} ${number} просмотренной`}
                            title={watched
                              ? "Снять отметку «просмотрено»"
                              : "Отметить просмотренной и учесть полную длительность в статистике"}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleWatched(group.number, number, duration, video);
                            }}
                          >
                            <span className="eye-glyph" aria-hidden="true" />
                          </button>
                          <ScorePicker
                            compact
                            className="episode-score-picker"
                            value={ratings?.episodes[key]}
                            label={`Оценка: ${seasonLabel}, ${unit.toLowerCase()} ${number}`}
                            onChange={value => onEpisodeRatingChange(group.number, number, value)}
                          />
                        </div>
                      </EpisodeHoverPreview>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
