import type { Anime, Video } from "./types";
import { requestJson } from "./http";

export type EpisodeAirDates = Record<string, string>;

const cache = new Map<number, { expiresAt: number; request: Promise<EpisodeAirDates> }>();

export function animeMyAnimeListId(anime: Anime): number | undefined {
  const id = Number(anime.remote_ids?.myanimelist_id);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_000_000_000 ? id : undefined;
}

export function validAirDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Original episode numbering is retained when several parts share a UI season. */
export function episodeAirDate(video: Video | undefined, dates?: EpisodeAirDates): string | undefined {
  const value = video && dates?.[video.originNumber ?? video.number];
  return validAirDate(value) ? value : undefined;
}

export function formatAirDate(value: string): string {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}

export function episodeAddedDate(video?: Video): string | undefined {
  const timestamp = video?.episode_added_at;
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

export function fetchEpisodeAirDates(malId: number): Promise<EpisodeAirDates> {
  const previous = cache.get(malId);
  if (previous && previous.expiresAt > Date.now()) return previous.request;
  const entry = { expiresAt: Date.now() + 3600_000, request: Promise.resolve({} as EpisodeAirDates) };
  entry.request = (async () => {
    const dates: EpisodeAirDates = {};
    try {
      for (let page = 1; page <= 100; page++) {
        const result = await requestJson<{ dates: EpisodeAirDates; hasNextPage: boolean }>(
          `/api/episode-dates/${malId}?page=${page}`,
        );
        for (const [episode, date] of Object.entries(result.dates ?? {})) {
          if (validAirDate(date)) dates[episode] = date;
        }
        if (!result.hasNextPage) break;
      }
    } catch {
      // Keep earlier pages visible when a later page is temporarily unavailable.
      entry.expiresAt = Date.now() + 60_000;
    }
    return dates;
  })();
  cache.set(malId, entry);
  // The backend keeps the persistent cache; bound this tab's metadata as well.
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return entry.request;
}
