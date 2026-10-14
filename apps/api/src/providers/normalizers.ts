import { createHash } from "node:crypto";
import { z } from "zod";
import { animeSchema, trustedEmbedUrl, type ProviderPlaybackSource } from "@animesoul/contracts";
import { catalogMetadata } from "./catalog-metadata.js";

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, maximum = 160): string {
  return typeof value === "string" ? value.slice(0, maximum).trim() : "";
}
function label(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : text(value, 30);
}
function translationLabel(value: unknown): string {
  const name = text(value).replace(/^Озвучка\s+/i, "");
  return name.endsWith(".Subtitles") ? "Субтитры " + name.slice(0, -10) : name || "Оригинал";
}
export function yummyRows(value: unknown): unknown[] {
  const response = record(value).response;
  return Array.isArray(response) ? response : [];
}
const identity = z.object({ anime_id: z.number().int().positive(), title: z.string().min(1) });
export function normalizeYummyAnime(value: unknown) {
  const row = record(value);
  const parsed = identity.parse(row);
  const hash = createHash("sha256")
    .update("animesoul:catalog:yummy:" + parsed.anime_id)
    .digest("hex")
    .slice(0, 32);
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
  const poster = record(row.poster);
  const posterValue = text(poster.big ?? poster.fullsize, 2048);
  let image: string | null = null;
  try {
    const url = new URL(posterValue.startsWith("//") ? "https:" + posterValue : posterValue);
    if (url.protocol === "https:" && !url.username && !url.password) image = url.href;
  } catch {
    /* A missing poster does not invalidate an imported title. */
  }
  const status = text(record(row.anime_status).alias);
  const aliases = Array.isArray(row.other_titles)
    ? row.other_titles.filter((v): v is string => typeof v === "string")
    : [];
  const remote = record(row.remote_ids);
  const providers = [{ provider: "yummy", externalId: String(parsed.anime_id) }];
  if (Number(remote.shikimori_id) > 0)
    providers.push({ provider: "shikimori", externalId: String(remote.shikimori_id) });
  if (Number(remote.kp_id) > 0)
    providers.push({ provider: "kinopoisk", externalId: String(remote.kp_id) });
  return {
    anime: animeSchema.parse({
      ...catalogMetadata(row, "yummy"),
      id,
      slug: "anime-" + id,
      indexable: false,
      title: text(parsed.title, 300),
      originalTitle: text(row.original ?? row.title_en, 300),
      aliases: [...new Set(aliases)].slice(0, 50),
      description: text(row.description, 20000).replace(/<[^>]*>/g, ""),
      year: catalogMetadata(row, "yummy").year ?? (Number.isInteger(row.year) ? row.year : 0),
      genres: Array.isArray(row.genres)
        ? row.genres.map((v) => text(record(v).title)).filter(Boolean)
        : [],
      poster: image,
      status:
        status === "ongoing"
          ? "ongoing"
          : ["anons", "announced"].includes(status)
            ? "announced"
            : "released",
    }),
    providers,
  };
}
function sourceId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
export function normalizeYummyVideos(value: unknown): ProviderPlaybackSource[] {
  const rows: ProviderPlaybackSource[] = [];
  for (const raw of yummyRows(value)) {
    const row = record(raw);
    const data = record(row.data);
    const embedUrl = trustedEmbedUrl(row.iframe_url);
    const episode = label(row.number);
    if (!embedUrl || !episode) continue;
    rows.push({
      id: sourceId("yummy:" + row.video_id + ":" + embedUrl),
      provider: "yummy",
      player: text(data.player, 100).replace(/^Плеер\s+/i, "") || "Источник",
      translation: translationLabel(data.dubbing),
      season: "1",
      episode,
      embedUrl,
    });
  }
  return rows;
}
export function normalizeKodikVideos(value: unknown): ProviderPlaybackSource[] {
  const rows: ProviderPlaybackSource[] = [];
  const results = record(value).results;
  if (!Array.isArray(results)) return rows;
  for (const raw of results) {
    const release = record(raw);
    const translation = translationLabel(record(release.translation).title);
    const seasons = Object.entries(record(release.seasons));
    if (release.type === "anime" && seasons.length === 0)
      seasons.push(["1", { episodes: { "1": release.link } }]);
    for (const [season, value] of seasons) {
      for (const [episode, link] of Object.entries(record(record(value).episodes))) {
        const embedUrl = trustedEmbedUrl(typeof link === "string" ? link : record(link).link);
        if (!embedUrl || !label(season) || !label(episode)) continue;
        rows.push({
          id: sourceId("kodik:" + release.id + ":" + translation + ":" + season + ":" + episode),
          provider: "kodik",
          player: "Kodik",
          translation,
          season: label(season),
          episode: label(episode),
          embedUrl,
        });
      }
    }
  }
  return rows;
}
