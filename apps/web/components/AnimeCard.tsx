import Link from "next/link";
import type { Anime } from "@animesoul/contracts";
export function AnimeCard({ anime, index = 0 }: { anime: Anime; index?: number }) {
  return (
    <Link href={`/anime/${anime.slug}`} className="anime-card">
      <div className={`poster poster-${index % 4}`}>
        {anime.poster ? (
          <img src={anime.poster} alt="" width="320" height="448" loading="lazy" />
        ) : (
          <>
            <span className="poster-orb" />
            <span className="poster-title">{anime.originalTitle}</span>
          </>
        )}
      </div>
      <h3>{anime.title}</h3>
      <p>
        {anime.year} <span>·</span> {anime.genres.slice(0, 2).join(" / ")}
      </p>
    </Link>
  );
}
