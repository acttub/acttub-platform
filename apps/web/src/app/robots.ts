import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "../lib/seo/site-metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // rewrites로 같은 오리진에 노출되는 API 경로와 자동 문서도 크롤링에서 제외한다.
      disallow: ["/v2/", "/health", "/docs", "/redoc", "/openapi.json"],
    },
    sitemap: `${resolveSiteUrl()}/sitemap.xml`,
  };
}
