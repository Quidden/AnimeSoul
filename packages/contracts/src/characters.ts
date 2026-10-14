import { z } from "zod";
import { animeSchema } from "./catalog.js";

export const characterRoleSchema = z.enum(["main", "supporting", "background"]);
export type CharacterRole = z.infer<typeof characterRoleSchema>;
export const characterSummarySchema = z.object({
  id: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]{1,160}$/),
  name: z.string().min(1).max(300),
  originalName: z.string().max(300),
  japaneseName: z.string().max(300).optional(),
  aliases: z.array(z.string().max(300)).max(50),
  image: z.string().url().nullable(),
});
export type CharacterSummary = z.infer<typeof characterSummarySchema>;
export const characterSearchSchema = z.object({ items: z.array(characterSummarySchema).max(6) });
export const animeCharacterSchema = characterSummarySchema.extend({ role: characterRoleSchema });
export type AnimeCharacter = z.infer<typeof animeCharacterSchema>;
export const animeCharactersSchema = z.object({ items: z.array(animeCharacterSchema).max(512) });
export const voiceActorSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  image: z.string().url().nullable(),
  sourceUrl: z.string().url().nullable(),
});
export const characterDetailsSchema = characterSummarySchema.extend({
  description: z.string().max(50000),
  sourceUrl: z.string().url().nullable(),
  voiceActors: z.array(voiceActorSchema).max(50),
  appearances: z.array(z.object({ anime: animeSchema, role: characterRoleSchema })).max(512),
});
export type CharacterDetails = z.infer<typeof characterDetailsSchema>;
export const franchiseCharacterSchema = z.object({
  character: characterSummarySchema,
  appearances: z
    .array(z.object({ animeId: z.uuid(), role: characterRoleSchema }))
    .min(1)
    .max(256),
});
export type FranchiseCharacter = z.infer<typeof franchiseCharacterSchema>;
