import type { PartyPlayback, PartyState } from "./types";

export function playbackChangedByUser(
  previous: PartyPlayback | null,
  current: PartyPlayback,
) {
  if (!previous) return false;
  if (
    previous.animeId !== current.animeId
    || previous.season !== current.season
    || previous.episode !== current.episode
    || previous.dub !== current.dub
    || previous.player !== current.player
    || previous.playing !== current.playing
  ) return true;
  const expectedPosition = previous.playing
    ? previous.position + Math.max(0, (current.updatedAt - previous.updatedAt) / 1000)
    : previous.position;
  return Math.abs(current.position - expectedPosition) > 3;
}

export function playbackReachedTarget(
  target: PartyPlayback | null,
  current: PartyPlayback,
) {
  if (
    !target
    || target.animeId !== current.animeId
    || target.season !== current.season
    || target.episode !== current.episode
    || target.dub !== current.dub
    || target.player !== current.player
    || target.playing !== current.playing
  ) return false;
  const expectedPosition = target.playing
    ? target.position + Math.max(0, (current.updatedAt - target.updatedAt) / 1000)
    : target.position;
  return Math.abs(current.position - expectedPosition) <= 4;
}

export function roomPlaybackRevision(party: PartyState) {
  const playback = party.playback;
  if (!playback) return "empty";
  return [
    party.lastControllerId ?? "",
    playback.sentAt ?? playback.updatedAt ?? 0,
    playback.animeId,
    playback.season,
    playback.episode,
    playback.playing ? 1 : 0,
    Math.round(playback.position * 10),
  ].join(":");
}
