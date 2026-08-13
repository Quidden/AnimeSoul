import type { Anime, AnimeUserRatings, CommunityAnimeRating } from "./types";

export type RatingTarget =
  | { scope: "anime" }
  | { scope: "season"; season: number }
  | { scope: "episode"; season: number; episode: string };

export type RatingSource = {
  key: string;
  label: string;
  shortLabel: string;
  value: number;
};

const SOURCE_LABELS: Record<string, { label: string; shortLabel: string }> = {
  animesoul: { label: "AnimeSoul", shortLabel: "Soul" },
  average: { label: "YummyAnime", shortLabel: "Yummy" },
  kp_rating: { label: "Кинопоиск", shortLabel: "КП" },
  imdb_rating: { label: "IMDb", shortLabel: "IMDb" },
  anidub_rating: { label: "AniDub", shortLabel: "AniDub" },
  myanimelist_rating: { label: "MyAnimeList", shortLabel: "MAL" },
  worldart_rating: { label: "World Art", shortLabel: "WA" },
  shikimori_rating: { label: "Shikimori", shortLabel: "Shiki" },
};

const SOURCE_ORDER = [
  "average",
  "kp_rating",
  "imdb_rating",
  "myanimelist_rating",
  "shikimori_rating",
  "worldart_rating",
  "anidub_rating",
];

export function averageRating(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => (
    typeof value === "number" && Number.isFinite(value)
  ));
  if (!present.length) return undefined;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function episodeRatingKey(season: number, episode: string) {
  return `${season}:${episode}`;
}

export function seasonEpisodeAverage(
  ratings: AnimeUserRatings | undefined,
  season: number,
): number | undefined {
  if (!ratings) return undefined;
  const prefix = `${season}:`;
  return averageRating(
    Object.entries(ratings.episodes)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, score]) => score),
  );
}

export function seasonCombinedAverage(
  ratings: AnimeUserRatings | undefined,
  season: number,
): number | undefined {
  return averageRating([
    ratings?.seasons[String(season)],
    seasonEpisodeAverage(ratings, season),
  ]);
}

export function ratedSeasonNumbers(ratings: AnimeUserRatings | undefined): number[] {
  if (!ratings) return [];
  const numbers = new Set<number>();
  Object.keys(ratings.seasons).forEach(key => {
    const season = Number(key);
    if (Number.isFinite(season)) numbers.add(season);
  });
  Object.keys(ratings.episodes).forEach(key => {
    const season = Number(key.split(":", 1)[0]);
    if (Number.isFinite(season)) numbers.add(season);
  });
  return [...numbers].sort((left, right) => left - right);
}

export function animeSeasonsAverage(
  ratings: AnimeUserRatings | undefined,
): number | undefined {
  return averageRating(
    ratedSeasonNumbers(ratings).map(season => seasonCombinedAverage(ratings, season)),
  );
}

export function hasUserRatings(ratings: AnimeUserRatings | undefined): boolean {
  return Boolean(
    ratings?.anime
    || Object.keys(ratings?.seasons ?? {}).length
    || Object.keys(ratings?.episodes ?? {}).length,
  );
}

export function setUserRating(
  current: AnimeUserRatings | undefined,
  title: string,
  target: RatingTarget,
  value: number | undefined,
): AnimeUserRatings {
  const next: AnimeUserRatings = {
    title: title || current?.title,
    anime: current?.anime,
    seasons: { ...(current?.seasons ?? {}) },
    episodes: { ...(current?.episodes ?? {}) },
    updatedAt: Date.now(),
  };
  const score = validRating(value);

  if (target.scope === "anime") {
    next.anime = score;
  } else if (target.scope === "season") {
    assignScore(next.seasons, String(target.season), score);
  } else {
    assignScore(next.episodes, episodeRatingKey(target.season, target.episode), score);
  }
  return next;
}

function assignScore(map: Record<string, number>, key: string, value: number | undefined) {
  if (value === undefined) delete map[key];
  else map[key] = value;
}

function validRating(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10
    ? value
    : undefined;
}

export function animeApiRatings(anime: Anime): RatingSource[] {
  const raw = anime.rating ?? {};
  const keys = [...SOURCE_ORDER, ...Object.keys(raw).filter(key => !SOURCE_ORDER.includes(key))];
  const seen = new Set<string>();
  return keys.flatMap(key => {
    if (seen.has(key) || key === "counters" || (!key.includes("rating") && key !== "average")) return [];
    seen.add(key);
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return [];
    const known = SOURCE_LABELS[key];
    const fallback = sourceName(key);
    return [{
      key,
      label: known?.label ?? fallback,
      shortLabel: known?.shortLabel ?? fallback,
      value,
    }];
  });
}

export function ratingForSource(
  anime: Anime,
  ratings: AnimeUserRatings | undefined,
  source: string,
  communityRating?: CommunityAnimeRating,
): number | undefined {
  if (source === "user") return ratings?.anime;
  if (source === "calculated") return animeSeasonsAverage(ratings);
  if (source === "animesoul") return communityRating?.anime?.average;
  const value = anime.rating?.[source];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function formatRating(value: number | undefined) {
  return value === undefined ? "—" : value.toFixed(1);
}

export function sourceLabel(key: string) {
  return SOURCE_LABELS[key]?.label ?? sourceName(key);
}

function sourceName(key: string) {
  return key
    .replace(/_?rating_?/gi, " ")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase()) || "API";
}
