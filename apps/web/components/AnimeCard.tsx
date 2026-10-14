import Link from "next/link";
import type { Anime, GlobalSearchResponse } from "@animesoul/contracts";
import { Icon } from "./Icon";
import { AnimeRatings } from "./AnimeRatings";
import { ratingNumber } from "../lib/ratings";
import { CardLibraryActions, CardProgress } from "./CardLibrary";
import { formatLabels } from "../lib/catalog-filters";
import { SearchAnimeProgress } from "./SearchAnimeProgress";

export function AnimeCard({
  anime,
  compact = false,
  searchProgress,
}: {
  anime: Anime;
  compact?: boolean;
  searchProgress?: GlobalSearchResponse["anime"][number];
}) {
  const status =
    anime.status === "released" ? "Вышло" : anime.status === "ongoing" ? "Онгоинг" : "Анонс";
  if (compact)
    return (
      <Link href={`/anime/${anime.slug}`} className="profile-anime-tile">
        <span className="profile-poster">
          <span className="card-score-badge" title="Оценка Shikimori">
            ★ {anime.shikimoriScore ? ratingNumber(anime.shikimoriScore) : "—"}
          </span>
          {anime.poster ? (
            <img src={anime.poster} alt="" width="180" height="270" loading="lazy" />
          ) : (
            <span className="profile-poster-placeholder">
              <Icon name="image" />
            </span>
          )}
        </span>
        <strong>{anime.title}</strong>
        <span>{anime.year}</span>
      </Link>
    );
  return (
    <article className="anime-card">
      <div className="poster-wrap">
        <Link
          href={`/anime/${anime.slug}`}
          className="poster"
          aria-label={`Подробнее: ${anime.title}`}
        >
          {anime.poster ? (
            <img src={anime.poster} alt="" width="320" height="480" loading="lazy" />
          ) : (
            <span className="poster-placeholder">
              <Icon name="image" />
            </span>
          )}
          <span className={`release-badge ${anime.status}`}>
            <i />
            {status}
          </span>
          <span
            className="card-score-badge"
            title={anime.shikimoriScore ? "Оценка Shikimori" : "У Shikimori пока нет оценки"}
          >
            ★ {anime.shikimoriScore ? ratingNumber(anime.shikimoriScore) : "—"}
          </span>
        </Link>
        <CardLibraryActions animeId={anime.id} title={anime.title} />
      </div>
      <h3>
        <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
      </h3>
      <p className="card-meta-line">
        {anime.year || "—"} · {formatLabels[anime.format ?? "unknown"]}
        {anime.details?.duration ? ` · ${anime.details.duration} мин.` : ""}
        {!searchProgress && anime.details?.episodesTotal
          ? ` · ${anime.details.episodesTotal} серий`
          : ""}
      </p>
      <AnimeRatings anime={anime} compact />
      {(anime.franchiseSize ?? 1) > 1 && (
        <Link className="card-franchise-link" href={`/anime/${anime.slug}/franchise`}>
          Франшиза · {anime.franchiseSize}
        </Link>
      )}
      {searchProgress ? (
        <SearchAnimeProgress anime={searchProgress} />
      ) : (
        <CardProgress animeId={anime.id} />
      )}
      <div className="tagline">
        {anime.genres.slice(0, 3).map((genre) => (
          <Link key={genre} href={"/catalog/genres/" + encodeURIComponent(genre)}>
            {genre}
          </Link>
        ))}
      </div>
    </article>
  );
}
