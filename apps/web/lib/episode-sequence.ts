import type { AnimeFranchise, PlaybackSource } from "@animesoul/contracts";

const numeric = (a: string, b: string) => a.localeCompare(b, "ru", { numeric: true });

// Provider variants share a canonical episode. Never treat dubbings as episodes.
export function playbackSequence(sources: PlaybackSource[], preferred?: PlaybackSource) {
  const anchor =
    sources.find((s) => s.variantId === preferred?.variantId) ??
    sources.find((s) => s.translation === preferred?.translation) ??
    sources[0];
  // Different providers may call the same title season 0 or season 1.
  // Follow the selected variant's season labels, filling missing episodes from
  // alternate dubbings only within those seasons.
  const seasons = new Set(
    sources.filter((s) => s.variantId === anchor?.variantId).map((s) => s.season),
  );
  const groups = new Map<string, PlaybackSource[]>();
  for (const source of sources) {
    if (!seasons.has(source.season)) continue;
    const key = source.episodeId ?? `${source.season}:${source.episode}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return [...groups.values()]
    .map(
      (group) =>
        group.find((s) => s.variantId === preferred?.variantId) ??
        group.find((s) => s.translation === preferred?.translation) ??
        group[0]!,
    )
    .sort((a, b) => numeric(a.season, b.season) || numeric(a.episode, b.episode));
}

export function adjacentPlayback(
  sources: PlaybackSource[],
  current: PlaybackSource,
  direction: -1 | 1,
) {
  const sequence = playbackSequence(sources, current);
  const index = sequence.findIndex((s) =>
    current.episodeId
      ? s.episodeId === current.episodeId
      : s.season === current.season && s.episode === current.episode,
  );
  return index < 0 ? undefined : sequence[index + direction];
}

export function adjacentPart(
  franchise: AnimeFranchise,
  currentId: string,
  allowedIds: string[],
  direction: -1 | 1,
) {
  const date = (item: AnimeFranchise["items"][number]) =>
    Date.parse(item.anime.details?.airedAt ?? "") ||
    (item.anime.year > 0 ? Date.UTC(item.anime.year, 0, 1) : Infinity);
  const parts = [...franchise.items].sort((a, b) => date(a) - date(b));
  const current = parts.findIndex(({ anime }) => anime.id === currentId);
  if (current < 0) return undefined;
  for (let index = current + direction; index >= 0 && index < parts.length; index += direction)
    if (allowedIds.includes(parts[index]!.anime.id)) return parts[index];
  return undefined;
}

export const playbackIntentKey = "animesoul:playback-transition:1";
export type PlaybackIntent = {
  slug: string;
  episodeId: string;
  translation: string;
  direction: -1 | 1;
  autoplay: boolean;
  createdAt: number;
  viewportTop?: number;
  fromAnimeId?: string;
  fromEpisode?: string;
  travel?: number;
};
export function parsePlaybackIntent(
  value: unknown,
  slug: string,
  episodeId?: string,
  now = Date.now(),
): PlaybackIntent | null {
  if (!value || typeof value !== "object") return null;
  const intent = value as Partial<PlaybackIntent>;
  if (
    intent.slug !== slug ||
    typeof intent.episodeId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.episodeId) ||
    (episodeId && intent.episodeId !== episodeId) ||
    typeof intent.translation !== "string" ||
    intent.translation.length > 160 ||
    (intent.direction !== -1 && intent.direction !== 1) ||
    typeof intent.autoplay !== "boolean" ||
    typeof intent.createdAt !== "number" ||
    !Number.isFinite(intent.createdAt) ||
    (intent.viewportTop !== undefined &&
      (typeof intent.viewportTop !== "number" ||
        !Number.isFinite(intent.viewportTop) ||
        Math.abs(intent.viewportTop) > 10000)) ||
    (intent.fromAnimeId !== undefined &&
      (typeof intent.fromAnimeId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          intent.fromAnimeId,
        ))) ||
    (intent.fromEpisode !== undefined &&
      (typeof intent.fromEpisode !== "string" || intent.fromEpisode.length > 32)) ||
    (intent.travel !== undefined &&
      (typeof intent.travel !== "number" ||
        !Number.isFinite(intent.travel) ||
        intent.travel < 0 ||
        intent.travel > 1)) ||
    now - intent.createdAt < 0 ||
    now - intent.createdAt > 30000
  )
    return null;
  return intent as PlaybackIntent;
}

export function consumePlaybackIntent(
  storage: Pick<Storage, "getItem" | "removeItem">,
  slug: string,
  episodeId?: string,
  now = Date.now(),
) {
  try {
    const intent = parsePlaybackIntent(
      JSON.parse(storage.getItem(playbackIntentKey) ?? "null"),
      slug,
      episodeId,
      now,
    );
    if (intent) storage.removeItem(playbackIntentKey);
    return intent;
  } catch {
    return null;
  }
}
