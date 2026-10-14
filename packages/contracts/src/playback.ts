import { z } from "zod";

// Only established embed origins are accepted. Never accept a client-supplied video URL.
export const embedHosts = [
  "kodik.info",
  "kodik.cc",
  "kodik.biz",
  "kodikplayer.com",
  "kodikplay.com",
  "player.aksor.tv",
  "alloha.yani.tv",
  "aniqit.com",
  "aniboom.one",
] as const;
export function trustedEmbedUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.startsWith("//") ? "https:" + value : value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    if (!embedHosts.some((host) => url.hostname === host || url.hostname.endsWith("." + host)))
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export const providerStateSchema = z.enum([
  "enabled",
  "disabled",
  "environment-blocked",
  "missing-credentials",
  "error",
]);
export const providerPlaybackSourceSchema = z.object({
  id: z.string().min(1).max(120),
  provider: z.enum(["yummy", "kodik"]),
  player: z.string().max(100),
  translation: z.string().max(160),
  season: z.string().max(30),
  episode: z.string().max(30),
  embedUrl: z.string().refine((value) => trustedEmbedUrl(value) === value),
});
export type ProviderPlaybackSource = z.infer<typeof providerPlaybackSourceSchema>;
export const playbackSourceSchema = providerPlaybackSourceSchema
  .omit({ provider: true, player: true })
  .extend({
    variantId: z.string().regex(/^[a-f0-9]{24}$/),
    episodeId: z.uuid().optional(),
  });
export type PlaybackSource = z.infer<typeof playbackSourceSchema>;
export const playbackRevisionSchema = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) });
export const playbackSchema = playbackRevisionSchema.extend({
  animeId: z.string().uuid(),
  state: z.enum(["ready", "disabled", "unavailable", "empty"]),
  sources: z.array(playbackSourceSchema).max(20000),
});
export type Playback = z.infer<typeof playbackSchema>;
export function reconcilePlayback(sources: PlaybackSource[], previous: PlaybackSource | undefined) {
  const exact =
    previous &&
    sources.find((source) => source.id === previous.id && source.embedUrl === previous.embedUrl);
  const selected =
    exact ||
    sources.find(
      (source) =>
        (previous?.episodeId
          ? source.episodeId === previous.episodeId
          : source.season === previous?.season && source.episode === previous?.episode) &&
        source.variantId === previous?.variantId,
    ) ||
    sources.find((source) =>
      previous?.episodeId
        ? source.episodeId === previous.episodeId
        : source.season === previous?.season && source.episode === previous?.episode,
    ) ||
    sources[0];
  return { selected, keepPlaying: Boolean(exact) };
}
