import type { Tracker, Video } from "./types";

export function collectPlayableEpisodeDates(
  animeId: number,
  videos: Video[],
  dubs: string[] = [],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const video of videos) {
    if (!video.iframe_url?.trim()) continue;
    if (dubs.length && !dubs.includes(video.data.dubbing)) continue;
    const key = `${animeId}:${video.number}`;
    result.set(key, Math.max(result.get(key) ?? 0, (video.date ?? 0) * 1000));
  }
  return result;
}

export function reconcileTrackedEpisodes(
  tracker: Tracker,
  animeIds: number[],
  episodeDates: Map<string, number>,
  now = Date.now(),
): Tracker {
  const currentKeys = [...episodeDates.keys()];
  const previousKeys = new Set(tracker.knownEpisodeKeys ?? []);
  const sortedCurrentKeys = [...currentKeys].sort(
    (a, b) => (episodeDates.get(a) ?? 0) - (episodeDates.get(b) ?? 0),
  );
  const legacyGrowth = Math.max(0, currentKeys.length - tracker.knownEpisodes);
  const newKeys = (
    tracker.knownEpisodeKeys
      ? currentKeys.filter((key) => !previousKeys.has(key))
      : legacyGrowth > 0
        ? sortedCurrentKeys.slice(-legacyGrowth)
        : []
  ).sort((a, b) => (episodeDates.get(a) ?? 0) - (episodeDates.get(b) ?? 0));
  const needsBaseline = !tracker.lastCheckedAt && tracker.knownEpisodes === 0;
  const recoveredPending = tracker.pendingEpisodeKeys?.length
    ? tracker.pendingEpisodeKeys
    : tracker.newEpisodes > 0
      ? sortedCurrentKeys.slice(-tracker.newEpisodes)
      : [];
  const pendingEpisodeKeys = needsBaseline
    ? []
    : [...new Set([...recoveredPending, ...newKeys])];
  // API mirrors can temporarily return a successful but incomplete list.
  // Keep the historical baseline monotonic so a missing/reappearing episode
  // is never reported as a brand-new release.
  const knownEpisodeKeys = [...new Set([
    ...(tracker.knownEpisodeKeys ?? []),
    ...currentKeys,
  ])];
  return {
    ...tracker,
    animeIds,
    knownEpisodes: knownEpisodeKeys.length,
    knownEpisodeKeys,
    pendingEpisodeKeys,
    newEpisodes: pendingEpisodeKeys.length,
    lastCheckedAt: now,
  };
}

export function acknowledgeTrackedEpisode(tracker: Tracker, episodeKey: string): Tracker {
  const pendingEpisodeKeys = (tracker.pendingEpisodeKeys ?? []).filter(
    (key) => key !== episodeKey,
  );
  return { ...tracker, pendingEpisodeKeys, newEpisodes: pendingEpisodeKeys.length };
}
