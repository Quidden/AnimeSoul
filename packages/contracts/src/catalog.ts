import { z } from "zod";

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
});
export type Anime = z.infer<typeof animeSchema>;
export const catalogSchema = z.object({
  items: z.array(animeSchema),
  source: z.enum(["database", "development"]),
});
export const searchSchema = z.object({ q: z.string().trim().max(100).default("") });
