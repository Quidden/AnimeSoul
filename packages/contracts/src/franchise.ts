import { z } from "zod";
import { animeSchema } from "./catalog.js";
import { episodeSchema } from "./episodes.js";
import { franchiseCharacterSchema } from "./characters.js";

export const franchiseLimits = {
  items: 256,
  episodes: 20000,
  edges: 4096,
  externalLinks: 4096,
} as const;
export const franchiseSchema = z
  .object({
    currentAnimeId: z.uuid(),
    characters: z.array(franchiseCharacterSchema).max(512).default([]),
    externalLinks: z
      .array(
        z.object({
          sourceId: z.uuid(),
          anime: animeSchema,
          relation: z.string().regex(/^[a-z_]{1,40}$/),
        }),
      )
      .max(franchiseLimits.externalLinks)
      .default([]),
    edges: z
      .array(
        z.object({
          sourceId: z.uuid(),
          targetId: z.uuid(),
          relation: z.string().regex(/^[a-z_]{1,40}$/),
        }),
      )
      .max(franchiseLimits.edges)
      .default([]),
    items: z
      .array(
        z.object({
          anime: animeSchema,
          episodes: z.array(episodeSchema).max(franchiseLimits.episodes),
        }),
      )
      .min(1)
      .max(franchiseLimits.items),
  })
  .refine(
    (value) =>
      value.items.some((item) => item.anime.id === value.currentAnimeId) &&
      new Set(value.items.map((item) => item.anime.id)).size === value.items.length &&
      value.items.reduce((count, item) => count + item.episodes.length, 0) <=
        franchiseLimits.episodes &&
      value.items.every((item) =>
        item.episodes.every((episode) => episode.animeId === item.anime.id),
      ) &&
      new Set(value.characters.map((entry) => entry.character.id)).size ===
        value.characters.length &&
      value.characters.every(
        (entry) =>
          new Set(entry.appearances.map((appearance) => appearance.animeId)).size ===
            entry.appearances.length &&
          entry.appearances.every((appearance) =>
            value.items.some((item) => item.anime.id === appearance.animeId),
          ),
      ) &&
      value.edges.every(
        (edge) =>
          edge.sourceId !== edge.targetId &&
          value.items.some((item) => item.anime.id === edge.sourceId) &&
          value.items.some((item) => item.anime.id === edge.targetId),
      ) &&
      value.externalLinks.every(
        (link) =>
          value.items.some((item) => item.anime.id === link.sourceId) &&
          !value.items.some((item) => item.anime.id === link.anime.id),
      ),
    "Invalid franchise identities or episode count.",
  );
export type AnimeFranchise = z.infer<typeof franchiseSchema>;
