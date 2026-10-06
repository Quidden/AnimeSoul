import Link from "next/link";
import type { Anime } from "@animesoul/contracts";
import { Icon } from "./Icon";

export function AnimeCard({ anime, compact = false }: { anime: Anime; compact?: boolean }) {
  const status =
    anime.status === "released" ? "Вышло" : anime.status === "ongoing" ? "Онгоинг" : "Анонс";
  if (compact)
    return (
      <Link href={`/anime/${anime.slug}`} className="profile-anime-tile">
        <span className="profile-poster">
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
        <span className="card-open" aria-hidden="true">
          ↗
        </span>
      </Link>
      <h3>
        <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
      </h3>
      <p className="card-meta-line">
        {anime.year} · {anime.originalTitle}
      </p>
      <div className="tagline">
        {anime.genres.slice(0, 3).map((genre) => (
          <span key={genre}>{genre}</span>
        ))}
      </div>
    </article>
  );
}
