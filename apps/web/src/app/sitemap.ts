import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "../lib/seo/site-metadata";

export const dynamic = "force-static";

// 색인되는 공개 페이지는 랜딩과 앱 다운로드 둘뿐이다. 나머지는 전부 noindex다
// (`tests/seo-noindex-guard.test.mjs`가 지킨다).
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = resolveSiteUrl();

  return [{ url: `${baseUrl}/` }, { url: `${baseUrl}/app` }];
}
