import { z } from "zod";

export function episodeLabel(value: string): string {
  const key = value.normalize("NFC").trim();
  return /^\d{1,6}(?:\.\d{1,3})?$/.test(key) ? String(Number(key)) : key.toLowerCase();
}
export const episodeSchema = z.object({
  id: z.uuid(),
  animeId: z.uuid(),
  season: z.string().min(1).max(30),
  number: z.string().min(1).max(30),
  duration: z.number().positive().max(86400).nullable(),
});
export const episodeListSchema = z.object({ episodes: z.array(episodeSchema).max(20000) });
export type Episode = z.infer<typeof episodeSchema>;
export function episodeHref(slug: string, episodeId: string, seconds = 0) {
  const path = `/anime/${encodeURIComponent(slug)}/episodes/${episodeId}`;
  return seconds > 0 ? path + "?t=" + Math.min(86400, Math.floor(seconds)) : path;
}
export function resumeEpisodeHref(slug: string, episodeId: string) {
  return episodeHref(slug, episodeId) + "?resume=1";
}
export const timestampSchema = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d{1,5}(?:\.\d{1,3})?$/.test(value) ? Number(value) : value,
  z.number().finite().min(0).max(86400),
);
export const playbackSessionStartSchema = z.object({ episodeId: z.uuid() });
export const playbackProgressSchema = z.object({
  sessionId: z.uuid(),
  sequence: z.number().int().min(1).max(2147483647),
  position: z.number().finite().min(0).max(86400),
  duration: z.number().finite().min(0).max(86400),
  watchedDelta: z.number().finite().min(0).max(30),
  completed: z.boolean(),
  dubbing: z.string().max(120).default(""),
});
export const savedPlaybackSchema = z.object({
  progress: z
    .array(
      z.object({
        episodeId: z.uuid(),
        position: z.number(),
        duration: z.number(),
        completed: z.boolean(),
        updatedAt: z.string(),
        dubbing: z.string().max(120).default(""),
      }),
    )
    .max(20000),
});
