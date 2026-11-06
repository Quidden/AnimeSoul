import type { AnimeFranchise, PlaybackSource } from "@animesoul/contracts";

export function franchisePartOptions(franchise: AnimeFranchise) {
  return franchise.items.map(({ anime }) => {
    const label =
      anime.format === "tv"
        ? "TV-сериал"
        : anime.format === "movie"
          ? "Фильм"
          : anime.format === "special"
            ? "Спецвыпуск"
            : anime.format === "ova"
              ? "OVA"
              : anime.format === "ona"
                ? "ONA"
                : anime.format === "music"
                  ? "Музыкальное видео"
                  : "Часть";
    return { anime, label, href: `/anime/${encodeURIComponent(anime.slug)}#anime-watch` };
  });
}

export function choosePlaybackSource(
  sources: PlaybackSource[],
  explicitEpisodeId: string | undefined,
  previous: { season?: string; episode?: string; choice?: string },
) {
  if (explicitEpisodeId)
    return (
      sources.find(
        (source) => source.episodeId === explicitEpisodeId && source.variantId === previous.choice,
      ) ?? sources.find((source) => source.episodeId === explicitEpisodeId)
    );
  return (
    sources.find(
      (source) =>
        source.season === previous.season &&
        source.episode === previous.episode &&
        source.variantId === previous.choice,
    ) ??
    sources.find(
      (source) => source.season === previous.season && source.episode === previous.episode,
    ) ??
    // Season "0" holds specials: open the story itself first when it exists.
    sources.find((source) => source.season !== "0") ??
    sources[0]
  );
}

export function playbackRouteAction(
  currentEpisodeId: string | undefined,
  requestedEpisodeId: string | undefined,
  previousTime: number | undefined,
  requestedTime: number | undefined,
) {
  if (requestedEpisodeId && requestedEpisodeId !== currentEpisodeId) return "episode";
  if (requestedTime !== undefined && requestedTime !== previousTime) return "time";
  return "preserve";
}
