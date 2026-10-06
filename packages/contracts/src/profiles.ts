import { z } from "zod";

export const visibilitySchema = z.object({
  about: z.boolean(),
  favorites: z.boolean(),
  folders: z.boolean(),
  ratings: z.boolean(),
  statistics: z.boolean(),
});
export const publicProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  indexable: z.boolean(),
  avatar: z.string().nullable(),
  banner: z.string().nullable(),
  badge: z.string().nullable(),
  presence: z.enum(["online", "offline", "dnd"]),
  about: z.string().optional(),
  favoriteIds: z.array(z.string()).optional(),
  folders: z.array(z.object({ name: z.string(), animeIds: z.array(z.string()) })).optional(),
  ratings: z.array(z.object({ animeId: z.string(), score: z.number().min(1).max(10) })).optional(),
  statistics: z
    .object({ watched: z.number().int().nonnegative(), minutes: z.number().int().nonnegative() })
    .optional(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type ProfileRecord = Omit<PublicProfile, "presence"> & {
  presence: "online" | "offline" | "dnd" | "invisible";
  visibility: z.infer<typeof visibilitySchema>;
};

/** Remove private fields before any API, HTML or metadata serialization. */
export function publicProfile(record: ProfileRecord): PublicProfile {
  const { visibility, ...profile } = record;
  const result = {
    ...profile,
    presence: record.presence === "invisible" ? ("offline" as const) : record.presence,
  };
  if (!visibility.about) delete result.about;
  if (!visibility.favorites) delete result.favoriteIds;
  if (!visibility.folders) delete result.folders;
  if (!visibility.ratings) delete result.ratings;
  if (!visibility.statistics) delete result.statistics;
  return publicProfileSchema.parse(result);
}
