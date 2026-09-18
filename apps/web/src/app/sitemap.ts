import type { MetadataRoute } from "next";
import { ACTING_COACHING } from "../features/keyword-pages/content/acting-coaching";
import { AI_ACTING_COACHING } from "../features/keyword-pages/content/ai-acting-coaching";
import { GUIDES } from "../features/keyword-pages/content/guide/index";
import { resolveSiteUrl } from "../lib/seo/site-metadata";
import { loadAdmissionsStatic } from "../features/admissions/admissions-static";

export const dynamic = "force-static";

// 색인되는 공개 페이지는 랜딩, 앱 다운로드, 키워드 안내, 입시 정보, 가이드다. 나머지는 전부 noindex다
// (`tests/seo-noindex-guard.test.mjs`가 지킨다).
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = resolveSiteUrl();
  const admissions = loadAdmissionsStatic();
  const latestGuideDate = GUIDES.reduce(
    (latest, guide) => guide.updatedAt > latest ? guide.updatedAt : latest,
    GUIDES[0].updatedAt,
  );

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
    { url: `${baseUrl}/admissions`, lastModified: admissions.updated_at },
    ...admissions.universities.map(({ id }) => ({
      url: `${baseUrl}/admissions/${id}`,
      lastModified: admissions.updated_at,
    })),
    { url: `${baseUrl}/guide`, lastModified: latestGuideDate },
    ...GUIDES.map((guide) => ({
      url: `${baseUrl}${guide.path}`,
      lastModified: guide.updatedAt,
    })),
  ];
}
