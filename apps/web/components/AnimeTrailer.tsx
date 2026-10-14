"use client";
import { useState } from "react";
import { trailerEmbed } from "../lib/trailer";
export function AnimeTrailer({ urls }: { urls: string[] }) {
  const [selected, setSelected] = useState(0);
  const embeds = [...new Set(urls.map(trailerEmbed).filter((s): s is string => Boolean(s)))];
  if (!embeds.length) return null;
  return (
    <section className="anime-media" id="anime-trailer" aria-label="Трейлер">
      <div className="anime-trailer-frame">
        <iframe
          src={embeds[selected] ?? embeds[0]}
          title="Трейлер аниме"
          loading="lazy"
          allow="fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {embeds.length > 1 && (
        <label className="anime-trailer-select">
          Трейлер
          <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
            {embeds.map((_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}
