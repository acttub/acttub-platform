import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "../lib/seo/site-metadata";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${resolveSiteUrl()}/` }];
}
