"use client";
import { useState } from "react";
import type { Anime } from "@animesoul/contracts";
import { AnimeCard } from "./AnimeCard";
export function ProfileFavorites({ items }: { items: Anime[] }) {
  const [count, setCount] = useState(24);
  return (
    <>
      <div className="profile-anime-grid">
        {items.slice(0, count).map((anime) => (
          <AnimeCard key={anime.id} anime={anime} compact />
        ))}
      </div>
      {items.length > count && (
        <button
          type="button"
          className="outline profile-show-more"
          onClick={() => setCount((value) => value + 24)}
        >
          Показать ещё ({items.length - count})
        </button>
      )}
    </>
  );
}
