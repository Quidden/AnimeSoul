import "server-only";
import { cookies } from "next/headers";
import {
  animeSchema,
  animeCharactersSchema,
  characterDetailsSchema,
  characterSearchSchema,
  catalogSchema,
  catalogItemsSchema,
  globalSearchResponseSchema,
  type Anime,
  publicProfileSchema,
  playbackSchema,
  episodeSchema,
  episodeListSchema,
  franchiseSchema,
  streamSchema,
} from "@animesoul/contracts";
import { z } from "zod";
import { diagnosticPath } from "@animesoul/diagnostics/sanitize";
import { reportServerError } from "./diagnostics-server";
async function request(path: string, personalized = false) {
  const base = process.env.API_URL ?? "http://127.0.0.1:8020";
  const options: RequestInit = {
    ...(personalized ? { headers: { Cookie: (await cookies()).toString() } } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(
      path.includes("/stream")
        ? 55000
        : path.includes("/playback")
          ? 35000
          : path.includes("/anime/") ||
              path.includes("/characters/") ||
              path.startsWith("/api/search?")
            ? 12000
            : 5000,
    ),
  };
  let response: Response;
  async function failed(error: Error): Promise<never> {
    let cookie = "";
    try {
      cookie = (await cookies()).toString();
    } catch {
      /* Build-time requests have no session. */
    }
    await reportServerError(error, diagnosticPath(path), "request", cookie);
    throw error;
  }
  try {
    response = await fetch(new URL(path, base), options);
  } catch (cause) {
    return failed(new Error(`Content request failed: GET ${diagnosticPath(path)}`, { cause }));
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(
      `Content request failed: GET ${diagnosticPath(path)} (HTTP ${response.status})`,
    );
    if (response.status >= 500) return failed(error);
    throw error;
  }
  return response.json() as Promise<unknown>;
}
export async function getPlayback(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug) + "/playback");
  return result === null ? null : playbackSchema.parse(result);
}
export async function getEpisodes(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug) + "/episodes");
  return result === null ? null : episodeListSchema.parse(result);
}
export async function getEpisode(slug: string, id: string) {
  const result = await request(
    "/api/anime/" + encodeURIComponent(slug) + "/episodes/" + encodeURIComponent(id),
  );
  return result === null ? null : episodeSchema.parse(result);
}
export async function getStream(slug: string, source: string) {
  const result = await request(
    "/api/anime/" + encodeURIComponent(slug) + "/stream?source=" + encodeURIComponent(source),
    true,
  );
  return result === null ? null : streamSchema.parse(result);
}
export async function getCatalog(
  q = "",
  filters: Record<string, string | number | undefined> = {},
) {
  const params = new URLSearchParams({ q });
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined) params.set(key, String(value));
  return catalogSchema.parse(
    await request(
      "/api/catalog?" + params,
      filters.personalized === "1" || filters.ratingSource === "mine",
    ),
  );
}
export async function getGlobalSearch(query: string) {
  return globalSearchResponseSchema.parse(
    await request("/api/search?" + new URLSearchParams({ q: query }), true),
  );
}
export async function getCharacterSearch(query: string) {
  const result = await request("/api/characters/search?" + new URLSearchParams({ q: query }));
  return result === null ? { items: [] } : characterSearchSchema.parse(result);
}
export async function getCatalogByIds(ids: string[]) {
  const unique = [...new Set(ids)];
  const items: Anime[] = [];
  for (let start = 0; start < unique.length; start += 100)
    items.push(
      ...catalogItemsSchema.parse(
        await request("/api/catalog/by-ids?ids=" + unique.slice(start, start + 100).join(",")),
      ).items,
    );
  return { items };
}
export async function getAnime(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug));
  return result === null ? null : animeSchema.parse(result);
}
export async function getAnimeCharacters(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug) + "/characters");
  return result === null ? { items: [] } : animeCharactersSchema.parse(result);
}
export async function getCharacter(slug: string) {
  const result = await request("/api/characters/" + encodeURIComponent(slug));
  return result === null ? null : characterDetailsSchema.parse(result);
}
export async function getRelatedAnime(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug) + "/related");
  return result === null ? { items: [] } : catalogItemsSchema.parse(result);
}
export async function getFranchise(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug) + "/franchise");
  return result === null ? null : franchiseSchema.parse(result);
}
export async function getProfile(username: string) {
  const result = await request("/api/profiles/" + encodeURIComponent(username));
  return result === null ? null : publicProfileSchema.parse(result);
}
const sitemapSchema = z.array(z.object({ slug: z.string(), updatedAt: z.string() }));
const profileMapSchema = z.array(z.object({ username: z.string(), updatedAt: z.string() }));
export async function sitemapAnime() {
  return sitemapSchema.parse(await request("/api/sitemap/catalog"));
}
export async function sitemapProfiles() {
  return profileMapSchema.parse(await request("/api/sitemap/profiles"));
}
export async function sitemapEpisodes(bucket: number) {
  return z
    .array(z.object({ id: z.uuid(), slug: z.string() }))
    .max(50000)
    .parse(await request("/api/sitemap/episodes/" + bucket));
}
