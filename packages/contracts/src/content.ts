import { z } from "zod";
import { audienceSchema, personSchema } from "./social.js";
const uuid = z.uuid().transform((value) => value.toLowerCase());
export const contentLabelsSchema = z
  .array(z.enum(["spoiler", "18+", "nsfw"]))
  .max(3)
  .transform((v) => [...new Set(v)]);
export const postInputSchema = z
  .object({
    id: uuid.optional(),
    kind: z.enum(["text", "episode", "review"]),
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().min(2).max(10000),
    audience: audienceSchema,
    tags: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[\p{L}\p{N}_]{1,40}$/u),
      )
      .max(8)
      .transform((v) => [...new Set(v)]),
    labels: contentLabelsSchema,
    animeId: uuid.nullable().default(null),
    episodeId: uuid.nullable().default(null),
    timestamp: z.number().int().min(0).max(86400).nullable().default(null),
    score: z.number().int().min(1).max(10).nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      (v.kind === "episode"
        ? !!v.animeId && !!v.episodeId
        : !v.episodeId && (v.kind !== "review" || !!v.animeId)) &&
      (v.timestamp === null || v.kind === "episode") &&
      (v.score === null || v.kind === "review"),
  );
export const commentInputSchema = z
  .object({
    id: uuid.optional(),
    body: z.string().trim().min(2).max(4000),
    labels: contentLabelsSchema,
    animeId: uuid.nullable().default(null),
    episodeId: uuid.nullable().default(null),
    postId: uuid.nullable().default(null),
    parentId: uuid.nullable().default(null),
  })
  .strict()
  .refine((v) => [v.animeId, v.episodeId, v.postId].filter(Boolean).length === 1);
export const contentQuerySchema = z
  .object({
    authorId: uuid.optional(),
    animeId: uuid.optional(),
    episodeId: uuid.optional(),
    postId: uuid.optional(),
    discussions: z.literal("all").optional(),
    section: z.enum(["posts", "reviews", "comments"]).optional(),
    tag: z
      .string()
      .regex(/^[\p{L}\p{N}_]{1,40}$/u)
      .optional(),
    before: z.iso.datetime().optional(),
    beforeId: uuid.optional(),
  })
  .strict()
  .refine((v) => !!v.before === !!v.beforeId)
  .refine((v) => !v.discussions || Boolean(v.animeId && !v.episodeId && !v.postId && !v.authorId));
export const deleteContentSchema = z.object({ id: uuid }).strict();
export const adultPreferenceSchema = z
  .object({ enabled: z.boolean(), confirmed18: z.boolean() })
  .strict()
  .refine((v) => !v.enabled || v.confirmed18);
const target = z.object({ id: uuid, slug: z.string(), title: z.string() });
export const postSchema = z.object({
  id: uuid,
  author: personSchema,
  kind: z.enum(["text", "episode", "review"]),
  title: z.string(),
  body: z.string(),
  audience: audienceSchema,
  tags: z.array(z.string()),
  labels: contentLabelsSchema,
  anime: target.nullable(),
  episode: z.object({ id: uuid, season: z.string(), number: z.string() }).nullable(),
  timestamp: z.number().nullable(),
  score: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const commentSchema = z.object({
  href: z.string().startsWith("/").max(1024),
  id: uuid,
  author: personSchema,
  body: z.string(),
  labels: contentLabelsSchema,
  parentId: uuid.nullable(),
  animeId: uuid.nullable(),
  episodeId: uuid.nullable(),
  postId: uuid.nullable(),
  deleted: z.boolean(),
  createdAt: z.iso.datetime(),
});
const nextSchema = z.object({ before: z.iso.datetime(), beforeId: uuid }).nullable();
export const postListSchema = z.object({ items: z.array(postSchema).max(20), next: nextSchema });
export const commentListSchema = z.object({
  items: z.array(commentSchema).max(50),
  next: nextSchema,
});
export type ContentPost = z.infer<typeof postSchema>;
export type ContentComment = z.infer<typeof commentSchema>;
export type ContentQuery = z.infer<typeof contentQuerySchema>;
