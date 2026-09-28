import type { Anime } from "./types";
import { isMovieAnime, releaseStatus } from "./anime";
import type { AnimeMetadata } from "../features/player/useAnimeMetadata";

export function animeFormat(anime: Anime, kind?: string): string {
  const raw = (kind || `${anime.type?.alias ?? ""} ${anime.type?.name ?? ""} ${anime.type?.shortname ?? ""}`).toLowerCase();
  if (/movie|фильм/.test(raw) || (!kind && isMovieAnime(anime))) return "movie";
  if (/ova/.test(raw)) return "ova";
  if (/ona/.test(raw)) return "ona";
  if (/special|спешл|спец/.test(raw)) return "special";
  if (/music|клип/.test(raw)) return "music";
  return "series";
}

export function animeCatalogFilters(anime: Anime, metadata?: AnimeMetadata) {
  return {
    format: animeFormat(anime, metadata?.kind),
    status: ({ released: "released", ongoing: "airing", anons: "planned" } as Record<string, string>)[metadata?.status ?? ""] ?? releaseStatus(anime).kind,
    year: metadata?.aired_on?.slice(0, 4) || String(anime.year || ""),
  };
}

