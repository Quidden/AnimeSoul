import type { Tracker } from "./types";

export function reconcileTrackedEpisodes(
  tracker: Tracker,
  animeIds: number[],
  episodeDates: Map<string, number>,
  now = Date.now(),
): Tracker {
  const keys = [...episodeDates.keys()];
  const previousKeys = new Set(tracker.knownEpisodeKeys ?? []);
  const migrationCutoff = now - 48 * 60 * 60 * 1000;
  const newKeys = (
    tracker.knownEpisodeKeys
      ? keys.filter((key) => !previousKeys.has(key))
      : tracker.lastCheckedAt
        ? keys.filter(
            (key) =>
              (episodeDates.get(key) ?? 0) >
              Math.min(tracker.lastCheckedAt!, migrationCutoff),
          )
        : []
  ).sort((a, b) => (episodeDates.get(a) ?? 0) - (episodeDates.get(b) ?? 0));
  const needsBaseline = !tracker.lastCheckedAt && tracker.knownEpisodes === 0;
  const recoveredPending = tracker.pendingEpisodeKeys?.length
    ? tracker.pendingEpisodeKeys.filter((key) => episodeDates.has(key))
    : tracker.newEpisodes > 0
      ? [...keys]
          .sort((a, b) => (episodeDates.get(a) ?? 0) - (episodeDates.get(b) ?? 0))
          .slice(-tracker.newEpisodes)
      : [];
  const pendingEpisodeKeys = needsBaseline
    ? []
    : [...new Set([...recoveredPending, ...newKeys])];
  return {
    ...tracker,
    animeIds,
    knownEpisodes: keys.length,
    knownEpisodeKeys: keys,
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
