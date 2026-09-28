import { useEffect, useState } from "react";
import type { Anime } from "../lib/types";
import { fetchAnimeDetails } from "../features/catalog/api";

/** The same fixed background on every surface, with an explicit title override. */
export function AmbientBackdrop({ anime, animeId = anime?.anime_id, enabled = true }: {
  anime?: Anime | null;
  animeId?: number;
  enabled?: boolean;
}) {
  const [resolved, setResolved] = useState<Anime>();
  const suppliedPoster = anime?.anime_id === animeId ? anime?.poster?.fullsize || anime?.poster?.big : undefined;
  const poster = suppliedPoster || (resolved?.anime_id === animeId ? resolved?.poster?.fullsize || resolved?.poster?.big : undefined);
  useEffect(() => {
    if (!enabled || !animeId || poster) return;
    let cancelled = false;
    void fetchAnimeDetails([animeId]).then(items => {
      if (!cancelled) setResolved(items.find(item => item.anime_id === animeId));
    }).catch(() => { /* Keep the theme glow when a poster cannot be loaded. */ });
    return () => { cancelled = true; };
  }, [animeId, enabled, poster]);
  if (!enabled) return null;
  return <div className="anime-ambient" aria-hidden="true">
    <div className="ambient-theme-clouds" />
    {poster && <img key={poster} src={poster} alt="" decoding="async" />}
  </div>;
}
