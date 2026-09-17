import type { MetadataRoute } from "next";
import { ACTING_COACHING } from "../features/keyword-pages/content/acting-coaching";
import { AI_ACTING_COACHING } from "../features/keyword-pages/content/ai-acting-coaching";
import { resolveSiteUrl } from "../lib/seo/site-metadata";

export const dynamic = "force-static";

// 색인되는 공개 페이지는 랜딩, 앱 다운로드, 키워드 안내 둘이다. 나머지는 전부 noindex다
// (`tests/seo-noindex-guard.test.mjs`가 지킨다).
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = resolveSiteUrl();

  return [
    { url: `${baseUrl}/` },
    { url: `${baseUrl}/app` },
    {
      url: `${baseUrl}${AI_ACTING_COACHING.path}`,
      lastModified: AI_ACTING_COACHING.updatedAt,
    },
    {
      url: `${baseUrl}${ACTING_COACHING.path}`,
      lastModified: ACTING_COACHING.updatedAt,
    },
  ];
}
