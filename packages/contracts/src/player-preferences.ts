import { z } from "zod";

export const dubbingNameSchema = z.string().trim().min(1).max(120);
export const playerPreferencesSchema = z.object({
  resume: z.boolean().default(true),
  autoplay: z.boolean().default(false),
  favoriteDubbings: z.array(dubbingNameSchema).max(50).default([]),
});
export type PlayerPreferences = z.infer<typeof playerPreferencesSchema>;
export const playerPreferencesEditSchema = z
  .object({
    resume: z.boolean().optional(),
    autoplay: z.boolean().optional(),
  })
  .strict();
export const favoriteDubbingSchema = z
  .object({ dubbing: dubbingNameSchema, favorite: z.boolean() })
  .strict();
export const animeDubbingSchema = z
  .object({ animeId: z.uuid(), dubbing: dubbingNameSchema.nullable() })
  .strict();
export const playerStateSchema = z.object({
  preferences: playerPreferencesSchema,
  dubbing: dubbingNameSchema.nullable(),
});
export function readPlayerPreferences(value: unknown): PlayerPreferences {
  const parsed = playerPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : playerPreferencesSchema.parse({});
}
export function dubbingKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru");
}
