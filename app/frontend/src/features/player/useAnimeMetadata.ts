import { useEffect, useState } from "react";
import type { Anime } from "../../lib/types";
import { requestJson } from "../../lib/http";

export interface AnimeMetadata {
  name?: string;
  source?: string;
  russian?: string;
  japanese?: string[];
  synonyms?: string[];
  description?: string;
  score?: string;
  kind?: string;
  status?: string;
  rating?: string;
  episodes?: number;
  episodes_aired?: number;
  duration?: number;
  aired_on?: string;
  released_on?: string;
  next_episode_at?: string;
  studios?: { id: number; name: string }[];
  genres?: { id: number; russian?: string; name: string }[];
  videos?: { url?: string; hosting?: string; kind?: string; name?: string }[];
}

const metadataCache = new Map<number, { expires: number; request: Promise<AnimeMetadata> }>();

export function fetchAnimeMetadata(id: number): Promise<AnimeMetadata> {
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve({});
  const cached = metadataCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.request;
  const request = requestJson<{ metadata: AnimeMetadata }>(`/api/yummy?mode=shikimori&id=${id}`)
    .then(({ metadata }) => metadata)
    .catch(error => { metadataCache.delete(id); throw error; });
  if (metadataCache.size >= 256) metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(id, { expires: Date.now() + 5 * 60_000, request });
  return request;
}

export function useAnimeMetadata(anime: Anime) {
  const id = Number(anime.remote_ids?.shikimori_id);
  const [result, setResult] = useState<{ id: number; metadata: AnimeMetadata }>();
  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    void fetchAnimeMetadata(id)
      .then(metadata => { if (!cancelled) setResult({ id, metadata }); })
      .catch(() => { /* Keep existing catalogue details when offline. */ });
    return () => { cancelled = true; };
  }, [id]);
  return result?.id === id ? result.metadata : undefined;
}

/** Render API descriptions as plain text, never as remote HTML. */
export function descriptionText(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/\[\/?[^\]]+\]/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}
