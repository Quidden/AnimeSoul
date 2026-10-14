import { z } from "zod";
import { animeSchema } from "./catalog.js";
import { personSchema } from "./social.js";
import { characterSummarySchema } from "./characters.js";

export const globalSearchQuerySchema = z
  .object({ q: z.string().trim().max(240).default("") })
  .strict();
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

export const searchAnimeSchema = animeSchema.extend({
  episodes: z.object({
    total: z.number().int().nonnegative().nullable(),
    available: z.number().int().nonnegative().nullable(),
  }),
  watchProgress: z
    .object({
      status: z.enum(["not_started", "watching", "completed", "caught_up"]),
      completedEpisodes: z.number().int().nonnegative(),
      startedEpisodes: z.number().int().nonnegative(),
      percent: z.number().min(0).max(100).nullable(),
      lastEpisode: z
        .object({
          season: z.string(),
          number: z.string(),
          percent: z.number().min(0).max(100).nullable(),
        })
        .nullable(),
    })
    .nullable(),
});
export type SearchAnime = z.infer<typeof searchAnimeSchema>;

export const globalSearchResponseSchema = z.object({
  query: z.string().max(240),
  anime: z.array(searchAnimeSchema).max(8),
  people: z.array(personSchema).max(6),
  characters: z.array(characterSummarySchema).max(6).default([]),
  genres: z
    .array(z.object({ name: z.string().min(1).max(100), count: z.number().int().nonnegative() }))
    .max(100),
  correction: z.string().max(500).nullable(),
});
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;
