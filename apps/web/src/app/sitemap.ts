import type { MetadataRoute } from "next";
import { ACTING_COACHING } from "../features/keyword-pages/content/acting-coaching";
import { AI_ACTING_COACHING } from "../features/keyword-pages/content/ai-acting-coaching";
import { GUIDES } from "../features/keyword-pages/content/guide/index";
import { resolveSiteUrl } from "../lib/seo/site-metadata";
import { loadBlogSummaries } from "../lib/api/v2/blog";
import { loadAdmissionsStatic } from "../features/admissions/admissions-static";

export const revalidate = 300;

// 색인되는 공개 페이지는 랜딩, 앱 다운로드, 고객센터, 개인정보 처리방침, 키워드 안내, 입시 정보, 가이드다. 나머지는 전부 noindex다
// (`tests/seo-noindex-guard.test.mjs`가 지킨다).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const blogPosts = await loadBlogSummaries();
  const baseUrl = resolveSiteUrl();
  const admissions = loadAdmissionsStatic();
  const latestGuideDate = GUIDES.reduce(
    (latest, guide) => guide.updatedAt > latest ? guide.updatedAt : latest,
    GUIDES[0].updatedAt,
  );

  return [
    { url: `${baseUrl}/` },
    { url: `${baseUrl}/app` },
    { url: `${baseUrl}/help` },
    { url: `${baseUrl}/privacy` },
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
    { url: `${baseUrl}/blog`, lastModified: blogPosts[0]?.publishedAt ?? latestGuideDate },
    ...blogPosts.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: post.publishedAt,
    })),
  ];
}
