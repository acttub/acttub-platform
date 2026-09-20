import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

// 셸/CI에 NEXT_PUBLIC_SITE_URL이 설정돼 있어도 기본값 검증이 결정적이어야 한다.
delete process.env.NEXT_PUBLIC_SITE_URL;

const { default: robots } = await import("../src/app/robots.ts");
const { default: sitemap } = await import("../src/app/sitemap.ts");
const { AI_ACTING_COACHING } = await import(
  "../src/features/keyword-pages/content/ai-acting-coaching.ts"
);
const { ACTING_COACHING } = await import(
  "../src/features/keyword-pages/content/acting-coaching.ts"
);
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
    // 본문을 손보면 updatedAt이 바뀌므로 날짜를 박지 않고 본문에서 읽는다.
    {
      url: "https://acttub.com/ai-acting-coaching",
      lastModified: AI_ACTING_COACHING.updatedAt,
    },
    {
      url: "https://acttub.com/acting-coaching",
      lastModified: ACTING_COACHING.updatedAt,
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

// 결정 I-8: 포트폴리오 공개 페이지는 링크를 아는 사람만 본다. 검색 엔진에 길을 알려 주지 않는다 —
// sitemap 에 싣지 않고, robots 의 disallow 에도 적지 않는다(적으면 그 경로가 있다는 것부터 알린다).
// 색인을 막는 것은 페이지의 noindex 메타다(tests/seo-noindex-guard).
test("account.portfolio: sitemap 과 robots 어디에도 포트폴리오 공개 주소(/p)와 이관 화면이 없다", () => {
  const urls = sitemap().map(({ url }) => new URL(url).pathname);
  assert.deepEqual(
    urls.filter((path) => path === "/p" || path.startsWith("/p/") || path === "/transfer"),
    [],
  );

  const { rules } = robots();
  const listed = [rules.allow, rules.disallow].flat();
  assert.equal(
    listed.some((path) => path === "/p" || path.startsWith("/p/")),
    false,
  );
});
