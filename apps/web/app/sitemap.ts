import type { MetadataRoute } from "next";
import { sitemapAnime, sitemapProfiles } from "../lib/api";
import { siteConfiguration } from "../lib/site";
import { catalogSections } from "../lib/catalog-filters";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteConfiguration();
  if (!site.indexable) return [];
  const [anime, profiles] = await Promise.all([sitemapAnime(), sitemapProfiles()]);
  const sections = catalogSections.filter((section) => section.key !== "for-you");
  if (anime.length + profiles.length + 4 + sections.length > 50000)
    throw new Error("Sitemap sharding is required before exceeding 50,000 URLs.");
  return [
    { url: site.url.href },
    { url: new URL("/catalog", site.url).href },
    { url: new URL("/search/frame", site.url).href },
    { url: new URL("/subscription", site.url).href },
    ...sections.map((section) => ({ url: new URL("/catalog/" + section.key, site.url).href })),
    ...anime.map((a) => ({
      url: new URL(`/anime/${a.slug}`, site.url).href,
      lastModified: a.updatedAt,
    })),
    ...profiles.map((p) => ({
      url: new URL(`/users/${encodeURIComponent(p.username)}`, site.url).href,
      lastModified: p.updatedAt,
    })),
  ];
}
