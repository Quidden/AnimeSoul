import { siteConfiguration } from "../../../lib/site";
export const dynamic = "force-dynamic";
export function GET() {
  const site = siteConfiguration();
  const entries = site.indexable
    ? Array.from(
        { length: 256 },
        (_, id) =>
          `<sitemap><loc>${new URL(`/episodes/sitemap/${id}.xml`, site.url).href.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</loc></sitemap>`,
      ).join("")
    : "";
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
