import { z } from "zod";

export const audienceSchema = z.enum(["public", "friends", "private"]);
const section = z
  .union([audienceSchema, z.boolean()])
  .transform((v) => (typeof v === "boolean" ? (v ? "public" : "private") : v));
export const sectionVisibilitySchema = z.object({
  about: section,
  favorites: section,
  folders: section,
  ratings: section,
  statistics: section,
  friends: section.default("private"),
  posts: section.default("private"),
  reviews: section.default("private"),
  comments: section.default("private"),
});
export type SectionVisibility = z.infer<typeof sectionVisibilitySchema>;
export function readVisibility(value: unknown): SectionVisibility {
  const parsed = sectionVisibilitySchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : sectionVisibilitySchema.parse({
        about: false,
        favorites: false,
        folders: false,
        ratings: false,
        statistics: false,
      });
}
export function canSee(audience: z.infer<typeof audienceSchema>, owner: boolean, friend: boolean) {
  return owner || audience === "public" || (audience === "friends" && friend);
}
export const socialActionSchema = z
  .object({
    targetId: z.uuid().transform((value) => value.toLowerCase()),
    action: z.enum([
      "request",
      "accept",
      "decline",
      "cancel",
      "unfriend",
      "follow",
      "unfollow",
      "block",
      "unblock",
    ]),
  })
  .strict();
export type SocialAction = z.infer<typeof socialActionSchema>;
export const personSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  avatar: z.string().nullable(),
});
export type Person = z.infer<typeof personSchema>;
export const relationshipSchema = z.object({
  person: personSchema,
  state: z.enum(["self", "none", "outgoing", "incoming", "friends", "blocked"]),
  following: z.boolean(),
  followsYou: z.boolean(),
  canRequest: z.boolean(),
  canFollow: z.boolean(),
});
export type Relationship = z.infer<typeof relationshipSchema>;
export const socialSections = [
  "friends",
  "incoming",
  "outgoing",
  "following",
  "followers",
  "blocked",
] as const;
export const socialListQuerySchema = z
  .object({ section: z.enum(socialSections).default("friends"), after: z.uuid().optional() })
  .strict();
export const socialListSchema = z.object({
  items: z.array(personSchema).max(50),
  next: z.uuid().nullable(),
});
export type SocialList = z.infer<typeof socialListSchema>;
export const peopleQuerySchema = z.object({ q: z.string().trim().min(2).max(40) }).strict();
export const peopleSchema = z.object({ items: z.array(personSchema).max(20) });
