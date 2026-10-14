"use client";
import type { Anime } from "@animesoul/contracts";
import { useCardLibrary } from "./CardLibrary";
import { ratingNumber } from "../lib/ratings";
export function AnimeRatings({ anime, compact = false }: { anime: Anime; compact?: boolean }) {
  const { library } = useCardLibrary();
  const mine = library?.items.find((i) => i.animeId === anime.id)?.score ?? anime.myScore;
  return (
    <div
      className={`anime-rating-board${compact ? " compact" : ""}`}
      aria-label={`Оценки: ${anime.title}`}
    >
      <span
        className="rating-chip shikimori"
        title={
          anime.shikimoriScore
            ? `Shikimori${anime.shikimoriVotes ? ` · ${anime.shikimoriVotes.toLocaleString("ru-RU")} голосов` : ""}`
            : "У Shikimori пока нет оценки"
        }
      >
        <b>★ {anime.shikimoriScore ? ratingNumber(anime.shikimoriScore) : "—"}</b>
        <small>Shikimori</small>
      </span>
      {anime.communityScore != null ? (
        <span className="rating-chip">
          <b>{ratingNumber(anime.communityScore)}</b>
          <small>AnimeSoul · {anime.communityVotes ?? 0}</small>
        </span>
      ) : null}
      {mine != null ? (
        <span className="rating-chip mine">
          <b>{mine}</b>
          <small>Моя</small>
        </span>
      ) : null}
    </div>
  );
}
