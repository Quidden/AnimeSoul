import type { MetadataRoute } from "next";
import { siteConfiguration } from "../lib/site";
export default function robots(): MetadataRoute.Robots {
  const site = siteConfiguration();
  return site.indexable
    ? {
        rules: {
          userAgent: "*",
          allow: ["/", "/catalog", "/anime/", "/users/"],
          disallow: ["/account", "/auth", "/admin", "/payment"],
        },
        sitemap: new URL("/sitemap.xml", site.url).href,
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
