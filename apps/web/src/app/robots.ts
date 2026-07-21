import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "../lib/seo/site-metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/v2/", "/health"],
    },
    sitemap: `${resolveSiteUrl()}/sitemap.xml`,
  };
}
