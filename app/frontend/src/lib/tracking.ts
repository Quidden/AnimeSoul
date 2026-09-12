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
  allDubEpisodeDates: Map<string, number> = episodeDates,
  identityCheckedAnimeIds: number[] = [],
): Tracker {
  const previouslyChecked = new Set(tracker.episodeIdentityCheckedIds ?? []);
  const repairIds = new Set(identityCheckedAnimeIds.filter(id => !previouslyChecked.has(id)));
  if (repairIds.size) {
    // The old fuzzy catalogue lookup persisted movie/old-season numbers under
    // upcoming titles. Repair each title once, only after both sources answer
    // through the corrected backend. Failed titles retain their full baseline.
    const keep = (key: string, dates: Map<string, number>) =>
      !repairIds.has(Number(key.split(":", 1)[0])) || dates.has(key);
    const knownEpisodeKeys = tracker.knownEpisodeKeys?.filter(key => keep(key, episodeDates));
    const pendingEpisodeKeys = tracker.pendingEpisodeKeys?.filter(key => keep(key, episodeDates));
    const pendingOtherDubEpisodeKeys = tracker.pendingOtherDubEpisodeKeys?.filter(key => keep(key, allDubEpisodeDates));
    tracker = {
      ...tracker,
      knownEpisodeKeys,
      knownEpisodes: knownEpisodeKeys?.length ?? tracker.knownEpisodes,
      knownAnyEpisodeKeys: tracker.knownAnyEpisodeKeys?.filter(key => keep(key, allDubEpisodeDates)),
      pendingEpisodeKeys,
      newEpisodes: pendingEpisodeKeys?.length ?? tracker.newEpisodes,
      pendingOtherDubEpisodeKeys,
      otherDubEpisodes: pendingOtherDubEpisodeKeys?.length ?? tracker.otherDubEpisodes,
      episodeIdentityCheckedIds: [...new Set([...previouslyChecked, ...repairIds])],
    };
  }
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
  const detectedNewRelease = !needsBaseline && newKeys.length > 0;
  // API mirrors can temporarily return a successful but incomplete list.
  // Keep the historical baseline monotonic so a missing/reappearing episode
  // is never reported as a brand-new release.
  const knownEpisodeKeys = [...new Set([
    ...(tracker.knownEpisodeKeys ?? []),
    ...currentKeys,
  ])];
  const allDubCurrentKeys = [...allDubEpisodeDates.keys()];
  const hasAnyDubBaseline = Array.isArray(tracker.knownAnyEpisodeKeys);
  const knownAnyEpisodeKeys = [...new Set([
    ...(tracker.knownAnyEpisodeKeys ?? []),
    ...allDubCurrentKeys,
  ])];
  const previousAnyKeys = new Set(tracker.knownAnyEpisodeKeys ?? []);
  const selectedCurrentKeys = new Set(currentKeys);
  const newOtherDubKeys = hasAnyDubBaseline
    ? allDubCurrentKeys.filter(
        (key) => !previousAnyKeys.has(key) && !selectedCurrentKeys.has(key),
      )
    : [];
  const pendingOtherDubEpisodeKeys = [...new Set([
    ...(tracker.pendingOtherDubEpisodeKeys ?? []),
    ...newOtherDubKeys,
  ])].filter((key) => !selectedCurrentKeys.has(key));
  const detectedAnyRelease = detectedNewRelease || newOtherDubKeys.length > 0;
  return {
    ...tracker,
    animeIds,
    knownEpisodes: knownEpisodeKeys.length,
    knownEpisodeKeys,
    pendingEpisodeKeys,
    newEpisodes: pendingEpisodeKeys.length,
    knownAnyEpisodeKeys,
    pendingOtherDubEpisodeKeys,
    otherDubEpisodes: pendingOtherDubEpisodeKeys.length,
    lastCheckedAt: now,
    // This is deliberately the detection time rather than the date reported by
    // the API. Several releases can share the same date (or have no date at all),
    // while the home list must always behave as "last release in, first out".
    lastNewEpisodeAt: detectedAnyRelease ? now : tracker.lastNewEpisodeAt,
  };
}

/** Newest detected release first, then stable original order for quiet entries. */
export function compareTrackedByRelease(left: Tracker, right: Tracker): number {
  const leftHasRelease = left.newEpisodes > 0 || (left.otherDubEpisodes ?? 0) > 0;
  const rightHasRelease = right.newEpisodes > 0 || (right.otherDubEpisodes ?? 0) > 0;
  if (leftHasRelease && !rightHasRelease) return -1;
  if (!leftHasRelease && rightHasRelease) return 1;
  if (leftHasRelease && rightHasRelease) {
    return (
      (right.lastNewEpisodeAt ?? right.lastCheckedAt ?? 0) -
      (left.lastNewEpisodeAt ?? left.lastCheckedAt ?? 0)
    );
  }
  return 0;
}

export function acknowledgeTrackedEpisode(tracker: Tracker, episodeKey: string): Tracker {
  const pendingEpisodeKeys = (tracker.pendingEpisodeKeys ?? []).filter(
    (key) => key !== episodeKey,
  );
  const pendingOtherDubEpisodeKeys = (tracker.pendingOtherDubEpisodeKeys ?? []).filter(
    (key) => key !== episodeKey,
  );
  return {
    ...tracker,
    pendingEpisodeKeys,
    newEpisodes: pendingEpisodeKeys.length,
    pendingOtherDubEpisodeKeys,
    otherDubEpisodes: pendingOtherDubEpisodeKeys.length,
  };
}
