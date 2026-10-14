import { z } from "zod";
import { audienceSchema, sectionVisibilitySchema } from "./social.js";
import { profileMediaValueSchema } from "./profile-media.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N}_-]+$/u);
export const passwordSchema = z.string().min(6).max(128);
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  password: passwordSchema,
});
export const loginFailureSchema = z.object({
  code: z.enum([
    "ACCOUNT_NOT_FOUND",
    "INVALID_PASSWORD",
    "ACCOUNT_DISABLED",
    "GOOGLE_LOGIN_REQUIRED",
    "PASSWORD_NOT_SET",
  ]),
});
export const loginFailureMessages: Record<z.infer<typeof loginFailureSchema>["code"], string> = {
  ACCOUNT_NOT_FOUND: "Аккаунт с такой почтой не найден.",
  INVALID_PASSWORD: "Неверный пароль.",
  ACCOUNT_DISABLED: "Аккаунт заблокирован. Обратитесь к администратору.",
  GOOGLE_LOGIN_REQUIRED: "Для этого аккаунта нужно войти через Google.",
  PASSWORD_NOT_SET: "У этого аккаунта не установлен пароль.",
};
export const registrationSchema = credentialsSchema.extend({ username: usernameSchema });
export const claimSchema = credentialsSchema.extend({ code: z.string().min(32).max(128) });
export const adminLoginSchema = credentialsSchema
  .extend({ code: z.string().min(6).max(64), remember: z.boolean().default(false) })
  .strict();
export const profileEditSchema = z.object({
  username: usernameSchema,
  about: z.string().max(2000),
  presence: z.enum(["online", "offline", "dnd", "invisible"]),
  isPublic: z.boolean(),
  indexable: z.boolean(),
  visibility: sectionVisibilitySchema,
  profileAccess: audienceSchema.optional(),
  friendRequests: z.enum(["everyone", "nobody"]).optional(),
  avatar: profileMediaValueSchema("avatar").nullable().optional(),
  banner: profileMediaValueSchema("banner").nullable().optional(),
});
export const libraryEditSchema = z.object({
  animeId: z.uuid(),
  favorite: z.boolean().optional(),
  score: z.number().int().min(0).max(10).nullable().optional(),
});
export const ratingEditSchema = z.object({
  animeId: z.uuid(),
  scope: z.enum(["season", "episode"]),
  key: z.string().min(1).max(100),
  score: z.number().int().min(0).max(10).nullable(),
});
export const folderEditSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
});
export const folderEntrySchema = z.object({
  folderId: z.uuid(),
  animeId: z.uuid(),
  remove: z.boolean().default(false),
  note: z.string().max(2000).default(""),
});
export const progressEditSchema = z.object({
  animeId: z.uuid(),
  episodeKey: z.string().min(1).max(80),
  position: z.number().min(0).max(86400),
  duration: z.number().min(0).max(86400),
  completed: z.boolean(),
  dubbing: z.string().max(120).default(""),
  season: z.number().int().min(1).max(1000).default(1),
});
export const privateVisibility = {
  about: false,
  favorites: false,
  folders: false,
  ratings: false,
  statistics: false,
};
export const accountSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  username: z.string(),
  avatar: z.string().nullable().default(null),
  profilePublic: z.boolean().default(false),
  emailVerified: z.boolean().default(false),
  hasPassword: z.boolean().default(true),
  googleLinked: z.boolean().default(false),
  roles: z.array(z.string()),
  permissions: z.array(z.enum(["providers.yummy.manage"])).default([]),
  mfaEnabled: z.boolean(),
  csrfToken: z.string(),
});
export type Account = z.infer<typeof accountSchema>;
export const privateProfileSchema = profileEditSchema.extend({
  avatar: z.string().nullable().default(null),
  banner: z.string().nullable().default(null),
  preferences: z.record(z.string(), z.unknown()),
});
export type PrivateProfile = z.infer<typeof privateProfileSchema>;
export const librarySchema = z.object({
  items: z.array(
    z.object({
      ratings: z.array(
        z.object({ scope: z.enum(["season", "episode"]), key: z.string(), score: z.number() }),
      ),
      animeId: z.uuid(),
      favorite: z.boolean(),
      score: z.number().nullable(),
      lastEpisode: z.string(),
      dubbing: z.string(),
      season: z.number(),
      anime: z.object({
        id: z.uuid(),
        slug: z.string(),
        title: z.string(),
        poster: z.string().nullable(),
        published: z.boolean(),
      }),
    }),
  ),
  folders: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      entries: z.array(z.object({ animeId: z.uuid(), note: z.string() })),
    }),
  ),
  progress: z.array(
    z.object({
      animeId: z.uuid(),
      episodeKey: z.string(),
      position: z.number(),
      duration: z.number(),
      completed: z.boolean(),
      watchedSeconds: z.number(),
      episode: z
        .object({ id: z.uuid(), season: z.string(), number: z.string() })
        .nullable()
        .optional(),
    }),
  ),
});
export type Library = z.infer<typeof librarySchema>;
