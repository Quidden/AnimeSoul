import type { MetadataRoute } from "next";
import { siteConfiguration } from "../lib/site";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const site = siteConfiguration();
  return site.indexable
    ? {
        rules: {
          userAgent: "*",
          allow: ["/", "/catalog", "/anime/", "/users/", "/search/frame"],
          disallow: [
            "/account",
            "/friends",
            "/community",
            "/posts/",
            "/library",
            "/catalog/for-you",
            "/auth",
            "/admin",
            "/payment",
          ],
        },
        sitemap: [
          new URL("/sitemap.xml", site.url).href,
          new URL("/episodes/sitemap-index.xml", site.url).href,
        ],
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
