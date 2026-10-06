import "server-only";
import { animeSchema, catalogSchema, publicProfileSchema } from "@animesoul/contracts";
import { z } from "zod";
async function request(path: string) {
  const base = process.env.API_URL ?? "http://127.0.0.1:8020";
  const response = await fetch(new URL(path, base), {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Content service is unavailable.");
  return response.json() as Promise<unknown>;
}
export async function getCatalog(q = "") {
  return catalogSchema.parse(await request("/api/catalog?q=" + encodeURIComponent(q)));
}
export async function getAnime(slug: string) {
  const result = await request("/api/anime/" + encodeURIComponent(slug));
  return result === null ? null : animeSchema.parse(result);
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
