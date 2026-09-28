import type { ReleaseScheduleRow } from "./ReleaseSchedule";
import type { AnimeMetadata } from "./useAnimeMetadata";

/** Shared by the anime page and the home banner, including related seasons. */
export function upcomingRelease(animeId: number, metadata: AnimeMetadata | undefined, rows: ReleaseScheduleRow[], now = Date.now() / 1000) {
  const metadataDate = metadata?.next_episode_at ? Date.parse(metadata.next_episode_at) / 1000 : 0;
  if (Number.isFinite(metadataDate) && metadataDate > now) return { timestamp: metadataDate, animeId };
  const upcoming = rows.filter(row => Number.isFinite(row.item.episodes?.next_date) && (row.item.episodes?.next_date ?? 0) > now)
    .sort((a, b) => (a.item.episodes?.next_date ?? 0) - (b.item.episodes?.next_date ?? 0));
  const row = upcoming.find(item => item.entry.anime_id === animeId) ?? upcoming[0];
  if (!row) return undefined;
  return { timestamp: row.item.episodes!.next_date!, animeId: row.entry.anime_id, title: row.entry.title };
}
