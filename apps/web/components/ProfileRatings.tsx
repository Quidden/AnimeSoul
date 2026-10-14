"use client";
import Link from "next/link";
import { useState } from "react";
import type { Anime, PublicProfile } from "@animesoul/contracts";
export function ProfileRatings({
  ratings,
  items,
}: {
  ratings: NonNullable<PublicProfile["ratings"]>;
  items: Anime[];
}) {
  const [count, setCount] = useState(10);
  const byId = new Map(items.map((anime) => [anime.id, anime]));
  return (
    <>
      <div className="profile-rating-list">
        {ratings.slice(0, count).map((rating, index) => {
          const anime = byId.get(rating.animeId);
          return (
            <div className="profile-rating-row" key={rating.animeId}>
              <span className="profile-rating-position">{index + 1}</span>
              <span className="profile-rating-info">
                {anime ? (
                  <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
                ) : (
                  <span>Аниме недоступно</span>
                )}
              </span>
              <span className="profile-rating-score">★ {rating.score} / 10</span>
            </div>
          );
        })}
      </div>
      {ratings.length > count && (
        <button
          type="button"
          className="outline profile-show-more"
          onClick={() => setCount((value) => value + 20)}
        >
          Показать ещё ({ratings.length - count})
        </button>
      )}
    </>
  );
}
