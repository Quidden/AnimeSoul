import {useEffect, useRef} from "react";
import type { Anime, AnimeProgress, AnimeUserRatings, CardMeta, CommunityAnimeRating } from "../lib/types";
import { formatDuration, isMovieAnime, releaseStatus, watchTimeProgress } from "../lib/anime";
import { animeApiRatings, formatRating } from "../lib/ratings";
import { RatingBoard } from "./RatingBoard";

export function AnimeCard({
  anime,
  meta,
  onOpen,
  favorite,
  onFavorite,
  onFolders,
  progress,
  ratings,
  communityRating,
  onVisible,
}: {
  anime: Anime;
  meta?: CardMeta;
  onOpen: (anime: Anime) => void;
  favorite: boolean;
  onFavorite: () => void;
  onFolders: () => void;
  progress?: AnimeProgress;
  ratings?: AnimeUserRatings;
  communityRating?: CommunityAnimeRating;
  onVisible?: (anime: Anime) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (meta || !onVisible) return;
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") {
      onVisible(anime);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      onVisible(anime);
    }, {rootMargin: "500px 0px"});
    observer.observe(card);
    return () => observer.disconnect();
  }, [anime.anime_id, meta, onVisible]);
  const whole = watchTimeProgress(progress);
  const isFranchise = (meta?.familyCount ?? anime.franchiseCount ?? 0) > 1;
  const status = meta?.status ?? releaseStatus(anime);
  const duration = meta?.durationMin
    ? meta.durationMin === meta.durationMax
      ? formatDuration(meta.durationMin)
      : `${formatDuration(meta.durationMin)}–${formatDuration(meta.durationMax)}`
    : "";
  const familyLabel = meta
    ? isFranchise
      ? `◆ ${meta.seasonCount} сез. · ${meta.movieCount} фильм.`
      : "◇ Отдельный тайтл"
    : "Проверяем связи…";
  const summaryRating = communityRating?.anime?.average
    ?? ratings?.anime
    ?? animeApiRatings(anime)[0]?.value;

  return (
    <article className="anime-card" ref={cardRef}>
      <div className="poster" onClick={() => onOpen(anime)}>
        {anime.poster?.big && <img src={anime.poster.big} alt="" loading="lazy" />}
        <span className={`release-badge ${status.kind}`}><i />{status.label}</span>
        {meta
          ? <span className={isFranchise ? "franchise-badge grouped" : "franchise-badge standalone"}>{familyLabel}</span>
          : <span className="availability-check" role="status" aria-label="Проверяем доступность видео"><i /><span>Проверка</span></span>}
        {summaryRating !== undefined && (
          <span className="mobile-card-rating" aria-label={`Рейтинг ${formatRating(summaryRating)}`}>
            <i aria-hidden="true">★</i>{formatRating(summaryRating)}
          </span>
        )}
        <button className="play">▶</button>
        <div className="card-actions">
          <button onClick={event => { event.stopPropagation(); onFavorite(); }}>{favorite ? "♥" : "♡"}</button>
          <button title="Добавить в папку" onClick={event => { event.stopPropagation(); onFolders(); }}>＋</button>
        </div>
      </div>
      <h3 onClick={() => onOpen(anime)}>{anime.title}</h3>
      <p className="card-meta-line">
        <span className="card-year">{anime.year ?? "—"}</span>
        <span className="card-format-details"> · {anime.type?.name ?? "Аниме"}{duration ? ` · ${duration}` : ""}{meta?.episodes ? ` · ${meta.episodes} ${isMovieAnime(anime) ? "часть" : "серий"}` : ""}</span>
      </p>
      <RatingBoard anime={anime} ratings={ratings} communityRating={communityRating} compact className="card-rating-board" />
      <div className="tagline">{anime.genres?.slice(0, 3).map(genre => <span key={genre.alias}>{genre.title}</span>)}</div>
      {progress && <div className="card-progress"><i style={{ width: `${whole}%` }} /><small>{whole}% всего времени</small></div>}
    </article>
  );
}
