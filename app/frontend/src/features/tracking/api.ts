import type { Anime, Tracker, Video } from "../../lib/types";
import { collectPlayableEpisodeDates } from "../../lib/tracking";

export type TrackingSnapshot = {
  animeIds: number[];
  episodeDates: Map<string, number>;
  allDubEpisodeDates: Map<string, number>;
  successfulRequests: number;
};

const REQUEST_PAUSE_MS = 220;

function mergeEpisodeDates(target: Map<string, number>, source: Map<string, number>) {
  for (const [key, date] of source) {
    target.set(key, Math.max(target.get(key) ?? 0, date));
  }
}

function uniqueAnimeIds(ids: number[]): number[] {
  return [...new Set(ids)].filter(Number.isFinite);
}

async function pauseBetweenRequests() {
  await new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
}

async function resolveFranchiseAnimeIds(seedIds: number[]): Promise<number[]> {
  try {
    const response = await fetch(`/api/yummy?mode=details&ids=${seedIds.join(",")}`);
    const payload = await response.json();
    if (!response.ok) return seedIds;

    const anime = (payload.anime ?? []) as Anime[];
    return uniqueAnimeIds([
      ...seedIds,
      ...anime.flatMap((entry) => [
        entry.anime_id,
        ...(entry.viewing_order ?? []).map((related) => related.anime_id),
      ]),
    ]);
  } catch {
    return seedIds;
  }
}

/**
 * Loads one complete tracking snapshot without mutating local storage.
 *
 * A partially unavailable API must never replace the previous baseline. The
 * caller can detect that case through `successfulRequests === 0` and skip the
 * reconciliation entirely.
 */
export async function fetchTrackingSnapshot(
  tracker: Tracker,
  isCancelled: () => boolean = () => false,
): Promise<TrackingSnapshot | null> {
  const seedIds = uniqueAnimeIds(
    tracker.animeIds?.length ? tracker.animeIds : [tracker.animeId],
  );
  const animeIds = await resolveFranchiseAnimeIds(seedIds);
  if (isCancelled()) return null;

  const episodeDates = new Map<string, number>();
  const allDubEpisodeDates = new Map<string, number>();
  let successfulRequests = 0;

  for (const animeId of animeIds) {
    if (isCancelled()) return null;
    try {
      const response = await fetch(`/api/yummy?mode=videos&id=${animeId}`);
      const payload = await response.json();
      if (response.ok) {
        successfulRequests += 1;
        const videos = (payload.videos ?? []) as Video[];
        mergeEpisodeDates(
          episodeDates,
          collectPlayableEpisodeDates(animeId, videos, tracker.dubs ?? []),
        );
        mergeEpisodeDates(
          allDubEpisodeDates,
          collectPlayableEpisodeDates(animeId, videos),
        );
      }
    } catch {
      // A single season may be temporarily unavailable. Other seasons still
      // contribute to the snapshot, but an entirely failed snapshot is ignored.
    }
    await pauseBetweenRequests();
  }

  return {
    animeIds,
    episodeDates,
    allDubEpisodeDates,
    successfulRequests,
  };
}
