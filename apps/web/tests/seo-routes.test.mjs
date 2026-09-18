import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

// 셸/CI에 NEXT_PUBLIC_SITE_URL이 설정돼 있어도 기본값 검증이 결정적이어야 한다.
delete process.env.NEXT_PUBLIC_SITE_URL;

const { default: robots } = await import("../src/app/robots.ts");
const { default: sitemap } = await import("../src/app/sitemap.ts");
const { GUIDES } = await import(
  "../src/features/keyword-pages/content/guide/index.ts"
);

test("robots는 공개 페이지를 허용하고 API 경로를 제외한다", () => {
  assert.deepEqual(robots(), {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/v2/", "/health", "/docs", "/redoc", "/openapi.json"],
    },
    sitemap: "https://acttub.com/sitemap.xml",
  });
});

test("sitemap은 공개 페이지, 입시 목록·대학 상세, 가이드를 순서대로 반환한다", () => {
  const latestGuideDate = GUIDES.reduce(
    (latest, guide) => guide.updatedAt > latest ? guide.updatedAt : latest,
    GUIDES[0].updatedAt,
  );
  const entries = sitemap();

  assert.deepEqual(entries.slice(0, 4), [
    { url: "https://acttub.com/" },
    { url: "https://acttub.com/app" },
    {
      url: "https://acttub.com/ai-acting-coaching",
      lastModified: "2026-09-17",
    },
    {
      url: "https://acttub.com/acting-coaching",
      lastModified: "2026-09-17",
    },
  ]);
  assert.ok(entries.some(({ url }) => url === "https://acttub.com/admissions"));
  assert.equal(
    entries.filter(({ url }) => url.startsWith("https://acttub.com/admissions/")).length,
    66,
  );
  assert.deepEqual(entries.slice(-(GUIDES.length + 1)), [
    { url: "https://acttub.com/guide", lastModified: latestGuideDate },
    ...GUIDES.map((guide) => ({
      url: `https://acttub.com${guide.path}`,
      lastModified: guide.updatedAt,
    })),
  ]);
  assert.ok(entries.every(({ url }) => url.startsWith("https://acttub.com/")));
});
