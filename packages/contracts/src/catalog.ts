import { z } from "zod";

export const animeDetailsSchema = z.object({
  franchiseFetchedAt: z.string().max(40).optional(),
  franchiseRelations: z
    .array(
      z.object({
        sourceId: z.string().regex(/^\d{1,15}$/),
        targetId: z.string().regex(/^\d{1,15}$/),
        relation: z.string().regex(/^[a-z_]{1,40}$/),
      }),
    )
    .max(4096)
    .optional(),
  relatedRelations: z
    .array(
      z.object({
        sourceId: z.string().regex(/^\d{1,15}$/),
        targetId: z.string().regex(/^\d{1,15}$/),
        relation: z.string().regex(/^[a-z_]{1,40}$/),
      }),
    )
    .max(100)
    .optional(),
  shikimoriFetchedAt: z.string().max(40).optional(),
  duration: z.number().int().nonnegative().optional(),
  episodesTotal: z.number().int().nonnegative().optional(),
  episodesAired: z.number().int().nonnegative().optional(),
  airedAt: z.string().max(40).optional(),
  releasedAt: z.string().max(40).optional(),
  nextEpisodeAt: z.string().max(40).optional(),
  studios: z.array(z.string().max(200)).max(30).optional(),
  ageRating: z.string().max(100).optional(),
  relatedExternalIds: z
    .array(z.string().regex(/^\d{1,15}$/))
    .max(100)
    .optional(),
  relatedAnimeIds: z.array(z.uuid()).max(100).optional(),
  trailerUrls: z.array(z.string().url()).max(10).optional(),
  screenshots: z.array(z.string().url()).max(20).optional(),
});

export const animeSchema = z.object({
  id: z.string().uuid(),
  indexable: z.boolean(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  originalTitle: z.string(),
  aliases: z.array(z.string()),
  description: z.string(),
  year: z.number().int(),
  genres: z.array(z.string()),
  poster: z.string().url().nullable(),
  status: z.enum(["released", "ongoing", "announced"]),
  shikimoriScore: z.number().min(0).max(10).nullable().optional(),
  shikimoriVotes: z.number().int().nonnegative().nullable().optional(),
  popularity: z.number().int().nonnegative().optional(),
  format: z.enum(["unknown", "tv", "movie", "ova", "ona", "special", "music"]).optional(),
  translations: z.array(z.string()).optional(),
  franchiseSize: z.number().int().positive().optional(),
  details: animeDetailsSchema.optional(),
  communityScore: z.number().min(0).max(10).nullable().optional(),
  communityVotes: z.number().int().nonnegative().optional(),
  myScore: z.number().min(0).max(10).nullable().optional(),
});
export type Anime = z.infer<typeof animeSchema>;
export const catalogSchema = z.object({
  items: z.array(animeSchema),
  source: z.enum(["database", "development"]),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().positive(),
  genres: z.array(z.string()),
  translations: z.array(z.string()).optional(),
  preferredGenres: z.array(z.object({ genre: z.string(), weight: z.number() })).optional(),
});
export const searchSchema = z.object({ q: z.string().trim().max(100).default("") });

const optionalYear = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().min(1900).max(2200).optional(),
);
export const catalogQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    genre: z.string().trim().max(100).default(""),
    status: z.enum(["", "released", "ongoing", "announced"]).default(""),
    sort: z
      .enum(["title", "newest", "oldest", "popular", "rating", "rating-asc"])
      .default("popular"),
    format: z.enum(["", "tv", "movie", "ova", "ona", "special", "music"]).default(""),
    group: z.enum(["", "franchise", "standalone"]).default(""),
    translation: z.string().trim().max(200).default(""),
    excludeGenre: z.string().trim().max(100).default(""),
    minRating: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce.number().min(0).max(10).optional(),
    ),
    ratingSource: z.enum(["shikimori", "community", "mine"]).default("shikimori"),
    personalized: z.enum(["0", "1"]).default("0"),
    from: optionalYear,
    to: optionalYear,
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(60),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, "Invalid year range.");
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export const randomCatalogQuerySchema = catalogQuerySchema.safeExtend({
  mode: z.enum(["all", "filtered", "taste"]).default("all"),
});
export const catalogIdsSchema = z
  .string()
  .max(3700)
  .transform((value) => (value ? value.split(",") : []))
  .pipe(z.array(z.string().uuid()).max(100));
export const catalogItemsSchema = z.object({ items: z.array(animeSchema) });
