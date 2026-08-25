import type { AnimeProgress } from "./types";

/**
 * Snapshot of the episode that owns a media element.
 *
 * Keeping this separate from the current React selection is important: a
 * final `timeupdate` from an element being torn down must still be written to
 * the episode that element was actually playing.
 */
export type PlaybackProgressTarget = Readonly<{
  key: string;
  season: number;
  episode: string;
  dub: string;
  player: string;
  seasonLabel?: string;
  originAnimeId?: number;
  originEpisode?: string;
  totalEpisodes?: number;
  totalDuration?: number;
  endingStart?: number;
}>;

export type PlaybackObservation = {
  time: number;
  duration: number;
  completed?: boolean;
  updatedAt?: number;
};

export function createPlaybackProgressTarget(
  input: Omit<PlaybackProgressTarget, "key">,
): PlaybackProgressTarget {
  return Object.freeze({
    ...input,
    key: `${input.season}:${input.episode}`,
  });
}

export function recordPlaybackObservation(
  snapshot: AnimeProgress | undefined,
  target: PlaybackProgressTarget,
  observation: PlaybackObservation,
) {
  const time = Number.isFinite(observation.time) ? Math.max(0, observation.time) : 0;
  const previous = snapshot?.episodes[target.key];
  const observedDuration = Number.isFinite(observation.duration) ? Math.max(0, observation.duration) : 0;
  const duration = observedDuration > 0 ? observedDuration : previous?.duration ?? 0;
  const percent = duration
    ? Math.max(0, Math.min(100, Math.round(time / duration * 100)))
    : previous?.percent ?? 0;
  const reachedEnd = Boolean(
    observation.completed
    || percent >= 100
    || ((target.endingStart ?? 0) > 0 && time >= (target.endingStart ?? 0)),
  );
  const startedAgain = Boolean(
    previous?.completed
    && time < 60
    && time < (previous.position ?? 0),
  );
  const rewatchArmed = startedAgain || previous?.rewatchArmed === true;
  const firstCompletion = reachedEnd && !previous?.completed;
  const repeatCompletion = reachedEnd && rewatchArmed;
  const previousPosition = previous?.position ?? 0;
  const delta = previous
    && time >= previousPosition
    && time - previousPosition <= 90
    ? time - previousPosition
    : 0;
  const completedNow = firstCompletion || repeatCompletion;
  const updatedAt = observation.updatedAt ?? Date.now();
  const value: AnimeProgress = {
    ...snapshot,
    episode: target.episode,
    dub: target.dub,
    season: target.season,
    seasonLabel: target.seasonLabel,
    originAnimeId: target.originAnimeId,
    originEpisode: target.originEpisode,
    totalEpisodes: target.totalEpisodes || snapshot?.totalEpisodes,
    totalDuration: target.totalDuration || snapshot?.totalDuration,
    episodes: {
      ...(snapshot?.episodes ?? {}),
      [target.key]: {
        position: time,
        duration,
        percent,
        originAnimeId: target.originAnimeId ?? previous?.originAnimeId,
        originEpisode: target.originEpisode ?? previous?.originEpisode,
        dub: target.dub,
        player: target.player,
        completed: previous?.completed || reachedEnd,
        completions: (previous?.completions ?? (previous?.completed ? 1 : 0)) + (completedNow ? 1 : 0),
        completionHistory: completedNow
          ? [...(previous?.completionHistory ?? []), updatedAt]
          : previous?.completionHistory,
        rewatchArmed: repeatCompletion ? false : rewatchArmed,
        watchedSeconds: (
          previous?.watchedSeconds
          ?? Math.min(previousPosition, previous?.duration || previousPosition)
        ) + Math.max(0, delta),
        updatedAt,
      },
    },
  };

  return {
    value,
    reachedEnd,
    originEpisodeKey: reachedEnd && target.originAnimeId && target.originEpisode
      ? `${target.originAnimeId}:${target.originEpisode}`
      : undefined,
  };
}
