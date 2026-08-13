import { RatingBoard } from "../components/RatingBoard";
import { ScorePicker } from "../components/ScorePicker";
import {
  animeSeasonsAverage,
  formatRating,
  hasUserRatings,
  ratedSeasonNumbers,
  seasonCombinedAverage,
  seasonEpisodeAverage,
  type RatingTarget,
} from "../lib/ratings";
import type { Anime, AnimeUserRatings, CommunityAnimeRating, CommunityRatings, UserRatings } from "../lib/types";

type RatingsPageProps = {
  ratings: UserRatings;
  communityRatings: CommunityRatings;
  catalog: Anime[];
  onHome: () => void;
  onOpen: (anime: Anime) => void;
  onRatingChange: (
    animeId: number,
    title: string,
    target: RatingTarget,
    value: number | undefined,
  ) => void;
};

export function RatingsPage({
  ratings,
  communityRatings,
  catalog,
  onHome,
  onOpen,
  onRatingChange,
}: RatingsPageProps) {
  const rows = Object.entries(ratings)
    .filter(([, value]) => hasUserRatings(value))
    .map(([animeId, value]) => ({
      animeId: Number(animeId),
      ratings: value,
      anime: catalog.find(item => item.anime_id === Number(animeId)),
    }))
    .sort((left, right) => (right.ratings.updatedAt ?? 0) - (left.ratings.updatedAt ?? 0));

  return (
    <section className="library ratings-page">
      <div className="section-head">
        <div>
          <span className="eyebrow">ЛИЧНЫЙ ЖУРНАЛ ОЦЕНОК</span>
          <h2>Оценки</h2>
          <p>Аниме, сезоны и серии — с отдельными оценками и автоматическими средними.</p>
        </div>
        <button className="outline" onClick={onHome}>← На главную</button>
      </div>

      <div className="ratings-table-head" aria-hidden="true">
        <span>Аниме</span>
        <span>Моя</span>
        <span>Средняя сезонов</span>
        <span>Общие / API</span>
      </div>

      <div className="ratings-anime-list">
        {rows.map(row => (
          <RatingAnimeRow
            key={row.animeId}
            animeId={row.animeId}
            anime={row.anime}
            ratings={row.ratings}
            communityRating={communityRatings[row.animeId]}
            onOpen={onOpen}
            onRatingChange={onRatingChange}
          />
        ))}
        {!rows.length && (
          <div className="empty ratings-empty">
            <b>Здесь пока нет оценок</b>
            <span>Откройте любое аниме и оцените тайтл, сезон или серию.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function RatingAnimeRow({
  animeId,
  anime,
  ratings,
  communityRating,
  onOpen,
  onRatingChange,
}: {
  animeId: number;
  anime?: Anime;
  ratings: AnimeUserRatings;
  communityRating?: CommunityAnimeRating;
  onOpen: (anime: Anime) => void;
  onRatingChange: RatingsPageProps["onRatingChange"];
}) {
  const title = anime?.title ?? ratings.title ?? `Аниме #${animeId}`;
  const seasons = ratedSeasonNumbers(ratings);
  return (
    <details className="rating-anime-row">
      <summary>
        <span className="rating-anime-title">
          {anime?.poster?.big
            ? <img src={anime.poster.big} alt="" />
            : <i aria-hidden="true">AS</i>}
          <span>
            <b>{title}</b>
            <small>{seasons.length} {pluralizeSeasons(seasons.length)}</small>
          </span>
        </span>
        <strong>{formatRating(ratings.anime)}</strong>
        <strong>{formatRating(animeSeasonsAverage(ratings))}</strong>
        {anime ? <RatingBoard anime={anime} ratings={ratings} communityRating={communityRating} compact apiOnly /> : <span>API загружается…</span>}
        <em>⌄</em>
      </summary>

      <div className="rating-anime-details">
        <div className="rating-anime-editor">
          <ScorePicker
            value={ratings.anime}
            label="Ваша оценка аниме"
            onChange={value => onRatingChange(animeId, title, { scope: "anime" }, value)}
          />
          {anime && <button className="outline" onClick={() => onOpen(anime)}>Открыть аниме →</button>}
        </div>
        <div className="rating-season-list">
          {seasons.map(season => (
            <RatingSeasonRow
              key={season}
              animeId={animeId}
              title={title}
              season={season}
              ratings={ratings}
              communityRating={communityRating}
              onRatingChange={onRatingChange}
            />
          ))}
          {!seasons.length && <div className="rating-tree-empty">Сезоны и серии ещё не оценены.</div>}
        </div>
      </div>
    </details>
  );
}

function RatingSeasonRow({
  animeId,
  title,
  season,
  ratings,
  communityRating,
  onRatingChange,
}: {
  animeId: number;
  title: string;
  season: number;
  ratings: AnimeUserRatings;
  communityRating?: CommunityAnimeRating;
  onRatingChange: RatingsPageProps["onRatingChange"];
}) {
  const prefix = `${season}:`;
  const episodes = Object.entries(ratings.episodes)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, score]) => ({ episode: key.slice(prefix.length), score }))
    .sort((left, right) => Number(left.episode) - Number(right.episode));
  return (
    <details className="rating-season-row" open>
      <summary>
        <b>Сезон {season}</b>
        <span>Оценка: <strong>{formatRating(ratings.seasons[String(season)])}</strong></span>
        <span>Средняя серий: <strong>{formatRating(seasonEpisodeAverage(ratings, season))}</strong></span>
        <span>Итог: <strong>{formatRating(seasonCombinedAverage(ratings, season))}</strong></span>
        <span>AnimeSoul: <strong>{formatRating(communityRating?.seasons[String(season)]?.average)}</strong></span>
        <ScorePicker
          compact
          value={ratings.seasons[String(season)]}
          label={`Оценка сезона ${season}`}
          onChange={value => onRatingChange(animeId, title, { scope: "season", season }, value)}
        />
        <em>⌄</em>
      </summary>
      <div className="rating-episode-list">
        {episodes.map(item => (
          <div className="rating-episode-row" key={item.episode}>
            <span>Серия {item.episode}</span>
            {communityRating?.episodes[`${season}:${item.episode}`] && (
              <small title={`${communityRating.episodes[`${season}:${item.episode}`].count} общих оценок`}>
                AnimeSoul {formatRating(communityRating.episodes[`${season}:${item.episode}`].average)}
              </small>
            )}
            <ScorePicker
              compact
              value={item.score}
              label={`Оценка серии ${item.episode}, сезон ${season}`}
              onChange={value => onRatingChange(
                animeId,
                title,
                { scope: "episode", season, episode: item.episode },
                value,
              )}
            />
          </div>
        ))}
        {!episodes.length && <div className="rating-tree-empty">Серии этого сезона ещё не оценены.</div>}
      </div>
    </details>
  );
}

function pluralizeSeasons(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "сезон";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сезона";
  return "сезонов";
}
