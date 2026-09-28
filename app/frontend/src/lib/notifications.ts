import type { Tracker } from "./types";
import { animeRoute } from "../features/navigation/routes";

export type AppNotification = {
  id: string;
  type: "new-episode";
  text: string;
  createdAt: number;
  read: boolean;
  href: string;
};

export const NOTIFICATION_READ_KEY = "animesoul:notifications:read";

export function episodeNotifications(trackers: Tracker[], readIds: string[]): AppNotification[] {
  const read = new Set(readIds);
  return trackers.flatMap(tracker => (tracker.pendingEpisodeKeys ?? []).map(key => {
    const [origin, episode] = key.split(":");
    const id = `new-episode:${tracker.animeId}:${key}`;
    return {
      id,
      type: "new-episode" as const,
      text: `${tracker.title} · серия ${episode}`,
      createdAt: tracker.lastNewEpisodeAt ?? tracker.lastCheckedAt ?? 0,
      read: read.has(id),
      href: animeRoute(tracker.animeId, undefined, episode, true, Number(origin)),
    };
  }));
}
