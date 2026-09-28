import type { Anime, HeroTrailer } from "../../lib/types";
import { fetchAnimeDetails, fetchAnimeTrailers, normalizeTrailers } from "../catalog/api";
import { fetchAnimeMetadata, type AnimeMetadata } from "./useAnimeMetadata";

export function youtubeTrailers(items: HeroTrailer[]) {
  return items.filter(item => /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]+$/.test(item.url))
    .filter((item, index, all) => all.findIndex(candidate => candidate.url === item.url) === index);
}

export function metadataTrailers(videos?: AnimeMetadata["videos"]) {
  return youtubeTrailers(normalizeTrailers(videos?.filter(video => !video.kind || ["pv", "cm", "character_trailer"].includes(video.kind)) ?? []));
}

/** Prefer the current season, then the nearest previous, then the next. */
export function preferredTrailerGroup(available: number[], current: number): number | undefined {
  if (available.includes(current)) return current;
  const previous = available.filter(index => index < current);
  return previous.length ? Math.max(...previous) : available.filter(index => index > current).sort((a, b) => a - b)[0];
}

const cache = new Map<string, { expires: number; request: Promise<HeroTrailer[]> }>();

export function fetchTitleTrailers(anime: Anime): Promise<HeroTrailer[]> {
  const key = `${anime.anime_id}:${anime.remote_ids?.shikimori_id ?? ""}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.request;
  const request = (async () => {
    const results = await Promise.allSettled([
      fetchAnimeTrailers(anime.anime_id),
      (async () => {
        const detailed = anime.remote_ids?.shikimori_id ? anime : (await fetchAnimeDetails([anime.anime_id]))[0] ?? anime;
        return metadataTrailers((await fetchAnimeMetadata(Number(detailed.remote_ids?.shikimori_id))).videos);
      })(),
    ]);
    // A failed provider can be retried when revisiting the page.
    if (results.some(result => result.status === "rejected")) cache.delete(key);
    return youtubeTrailers(results.flatMap(result => result.status === "fulfilled" ? result.value : []));
  })();
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 5 * 60_000, request });
  return request;
}
