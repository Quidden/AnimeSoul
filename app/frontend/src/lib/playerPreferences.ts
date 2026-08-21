/** Resolve a title voice with the documented A → B → C priority. */
export function preferredDubbing(
  available: string[],
  titleDubbing: string,
  favouriteDubbings: string[],
  providerDefault = "",
): string {
  if (titleDubbing && available.includes(titleDubbing)) return titleDubbing;
  const favourite = favouriteDubbings.find(name => available.includes(name));
  if (favourite) return favourite;
  if (providerDefault && available.includes(providerDefault)) return providerDefault;
  return available[0] ?? "";
}

/** A voice may be selected only when it has the episode currently on screen. */
export function dubbingHasEpisode(
  videos: ReadonlyArray<{ number: string; data: { dubbing: string } }>,
  dubbing: string,
  episode: string,
) {
  return videos.some(video => video.number === episode && video.data.dubbing === dubbing);
}

/** Resume keeps the exact episode first, then resolves a voice available for it. */
export function preferredDubbingForEpisode(
  videos: ReadonlyArray<{ number: string; data: { dubbing: string } }>,
  episode: string,
  rememberedDubbing: string,
  titleDubbing: string,
  favouriteDubbings: string[],
  providerDefault = "",
) {
  const available = Array.from(new Set(
    videos.filter(video => video.number === episode).map(video => video.data.dubbing),
  ));
  if (rememberedDubbing && available.includes(rememberedDubbing)) return rememberedDubbing;
  return preferredDubbing(available, titleDubbing, favouriteDubbings, providerDefault);
}

/** Prefer an exact downloaded quality, then the best downloaded rendition. */
export function preferredOfflineVideo<T extends {
  number: string;
  data: { dubbing: string };
  offline?: { quality: number };
}>(
  videos: ReadonlyArray<T>,
  dubbing: string,
  episode: string,
  quality: number,
): T | undefined {
  return videos
    .filter(video => video.offline && video.number === episode && video.data.dubbing === dubbing)
    .sort((left, right) => {
      const leftExact = left.offline?.quality === quality ? 1 : 0;
      const rightExact = right.offline?.quality === quality ? 1 : 0;
      return rightExact - leftExact
        || (right.offline?.quality ?? 0) - (left.offline?.quality ?? 0);
    })[0];
}

type DurationVideo = {
  number: string;
  duration?: number;
  data: { dubbing: string; player?: string };
};

function representativeDubbingDuration(videos: ReadonlyArray<DurationVideo>) {
  const kodik = videos.filter(video => /kodik/i.test(video.data.player ?? "") && Number(video.duration) > 0);
  const candidates = kodik.length ? kodik : videos.filter(video => Number(video.duration) > 0);
  return Math.max(0, ...candidates.map(video => Number(video.duration) || 0));
}

/** A duration difference is evidence of a different edit, not proof of censorship. */
export function dubbingDurationDeficit(
  videos: ReadonlyArray<DurationVideo>,
  dubbing: string,
  episode: string,
  minimumDifference = 45,
) {
  const episodeVideos = videos.filter(video => video.number === episode);
  const dubbings = Array.from(new Set(episodeVideos.map(video => video.data.dubbing)));
  const reference = Math.max(0, ...dubbings.map(name => representativeDubbingDuration(
    episodeVideos.filter(video => video.data.dubbing === name),
  )));
  const selected = representativeDubbingDuration(
    episodeVideos.filter(video => video.data.dubbing === dubbing),
  );
  const difference = reference - selected;
  return selected > 0 && difference >= minimumDifference ? difference : 0;
}

export function isSubtitleTranslation(dubbing: string, translationType?: unknown) {
  const kind = String(translationType ?? "").toLocaleLowerCase();
  const title = dubbing.toLocaleLowerCase();
  return kind.includes("subtit") || title.includes("субтит") || title.includes("subtit");
}

export function subtitleTranslationLabel(value: string) {
  return value
    .replace(/^субтитры\s*/i, "")
    .replace(/[.\s]*subtitles$/i, "")
    .trim() || "Kodik";
}

/** Keep an explicit per-title provider, otherwise prefer AnimeSoul for Kodik. */
export function preferredPlayer(
  available: string[],
  titlePlayer: string,
  animeSoulAvailable: boolean,
  fallback = "",
): string {
  if (titlePlayer && available.includes(titlePlayer)) return titlePlayer;
  if (animeSoulAvailable && available.includes("AnimeSoul")) return "AnimeSoul";
  if (fallback && available.includes(fallback)) return fallback;
  return available[0] ?? "";
}
