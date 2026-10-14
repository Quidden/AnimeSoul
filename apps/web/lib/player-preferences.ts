import { dubbingKey, type PlaybackSource, type PlayerPreferences } from "@animesoul/contracts";

// Per-title explicit selection wins; a continuation keeps its actual voice.
export function preferredDubbing(
  sources: PlaybackSource[],
  preferences: PlayerPreferences,
  manual: string | null,
  saved = "",
  fallback?: PlaybackSource,
) {
  for (const name of [manual, saved, ...preferences.favoriteDubbings]) {
    if (!name) continue;
    const match = sources.find((source) => dubbingKey(source.translation) === dubbingKey(name));
    if (match) return match;
  }
  return sources.find((source) => source.id === fallback?.id) ?? sources[0];
}
