import type { MetadataRoute } from "next";
import { notFound } from "next/navigation";
import { episodeHref } from "@animesoul/contracts";
import { sitemapEpisodes } from "../../lib/api";
import { siteConfiguration } from "../../lib/site";
export const dynamic = "force-dynamic";
export function generateSitemaps() {
  return Array.from({ length: 256 }, (_, id) => ({ id }));
}
export default async function sitemap({
  id,
}: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const bucket = await id;
  if (!/^(?:0|[1-9]\d{0,2})$/.test(bucket) || Number(bucket) > 255) notFound();
  const site = siteConfiguration();
  if (!site.indexable) return [];
  return (await sitemapEpisodes(Number(bucket))).map((item) => ({
    url: new URL(episodeHref(item.slug, item.id), site.url).href,
  }));
}
