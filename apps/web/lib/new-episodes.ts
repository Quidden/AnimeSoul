import type { Episode, Library } from "@animesoul/contracts";
import { nextHomeEpisode, recentHomeProgress } from "./home-viewing";

export type EpisodeAlert = {
  animeId: string;
  slug: string;
  title: string;
  poster: string | null;
  episode: Episode;
};

export const alertsDismissedKey = "animesoul:episode-alerts-dismissed";
export const alertLimit = 5;

// Titles whose latest watched episode is finished and have a following episode on the site:
// the library already tracks them, so nothing extra has to be stored on the server.
export function trackedSlugs(library: Library, limit = alertLimit + 1) {
  const slugs: string[] = [];
  for (const progress of recentHomeProgress(library.progress)) {
    if (!progress.completed) continue;
    const item = library.items.find((entry) => entry.animeId === progress.animeId);
    if (item?.anime.published) slugs.push(item.anime.slug);
    if (slugs.length >= limit) break;
  }
  return slugs;
}

export function newEpisodeAlerts(
  library: Library,
  episodes: Record<string, Episode[]>,
  dismissed: ReadonlySet<string> = new Set(),
): EpisodeAlert[] {
  const alerts: EpisodeAlert[] = [];
  for (const progress of recentHomeProgress(library.progress)) {
    const item = library.items.find((entry) => entry.animeId === progress.animeId);
    const list = item && episodes[item.anime.slug];
    if (!item?.anime.published || !list) continue;
    const next = nextHomeEpisode(progress, list);
    if (!next || dismissed.has(next.id)) continue;
    alerts.push({
      animeId: item.animeId,
      slug: item.anime.slug,
      title: item.anime.title,
      poster: item.anime.poster,
      episode: next,
    });
    if (alerts.length >= alertLimit) break;
  }
  return alerts;
}
