import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

// 셸/CI에 NEXT_PUBLIC_SITE_URL이 설정돼 있어도 기본값 검증이 결정적이어야 한다.
delete process.env.NEXT_PUBLIC_SITE_URL;

const {
  buildGuideIndexMetadata,
  buildKeywordPageMetadata,
  buildLandingMetadata,
  buildNoindexMetadata,
  buildRootMetadata,
  buildVerification,
  resolveSiteUrl,
} = await import("../src/lib/seo/site-metadata.ts");

const { AI_ACTING_COACHING } = await import(
  "../src/features/keyword-pages/content/ai-acting-coaching.ts"
);

const description =
  "AI 연기 코칭 앱 Acttub. 내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연기 연습 도구예요.";

test("사이트 URL은 기본값과 정상 http(s) 주소를 origin으로 정규화한다", () => {
  assert.equal(resolveSiteUrl(), "https://acttub.com");
  assert.equal(resolveSiteUrl("https://example.com"), "https://example.com");
  assert.equal(resolveSiteUrl("https://example.com/"), "https://example.com");
  assert.equal(resolveSiteUrl("http://localhost:8055"), "http://localhost:8055");
  // 사이트는 도메인 루트에서만 서빙되므로 path·인증정보·query·fragment는 제거된다.
  assert.equal(resolveSiteUrl("http://example.com/path/"), "http://example.com");
  assert.equal(resolveSiteUrl("https://example.com/stage"), "https://example.com");
  assert.equal(
    resolveSiteUrl("https://user:pw@example.com/base?utm=1#f"),
    "https://example.com",
  );
  assert.equal(resolveSiteUrl("https://example.com/?utm=1"), "https://example.com");
  assert.equal(resolveSiteUrl("https://example.com/#section"), "https://example.com");
});

test("사이트 URL은 빈 값, 공백, 비정상 scheme을 기본값으로 대체한다", () => {
  for (const raw of ["", "   ", "ftp://example.com", "not a url"]) {
    assert.equal(resolveSiteUrl(raw), "https://acttub.com");
  }
});

test("루트 metadata는 공통 title과 소셜 정보를 담되 URL 신호를 담지 않는다", () => {
  const metadata = buildRootMetadata("https://example.com/");

  assert.equal(metadata.metadataBase.href, "https://example.com/");
  assert.deepEqual(metadata.title, {
    default: "Acttub — AI 연기 코칭, 질문으로 다시 보는 연기 연습",
    template: "%s | Acttub",
  });
  assert.equal(metadata.description, description);
  assert.deepEqual(metadata.openGraph, {
    siteName: "Acttub",
    locale: "ko_KR",
    type: "website",
  });
  assert.deepEqual(metadata.twitter, { card: "summary_large_image" });
  assert.deepEqual(metadata.verification, {
    google: "zABzA1FHYUFDJR1hJmCKZqAdJDjZ7-Tz_zhWpOZ8hzg",
    other: {
      "naver-site-verification": "697b757ca85289cefc70141c0a879284c3ef8563",
    },
  });
  assert.equal(metadata.alternates, undefined);
  assert.equal("url" in metadata.openGraph, false);
});

test("소유권 metadata는 빈 네이버 값의 키를 만들지 않는다", () => {
  assert.deepEqual(buildVerification("google-code", ""), {
    google: "google-code",
  });
  assert.deepEqual(buildVerification("google-code", "naver-code"), {
    google: "google-code",
    other: { "naver-site-verification": "naver-code" },
  });
});

test("키워드 metadata는 canonical과 Article 공유 정보를 본문에서 만든다", () => {
  const metadata = buildKeywordPageMetadata(
    AI_ACTING_COACHING,
    "https://example.com/",
  );

  assert.equal(metadata.title, AI_ACTING_COACHING.title);
  assert.equal(metadata.description, AI_ACTING_COACHING.description);
  assert.equal(metadata.alternates.canonical, AI_ACTING_COACHING.path);
  assert.deepEqual(metadata.openGraph, {
    siteName: "Acttub",
    locale: "ko_KR",
    type: "article",
    url: `https://example.com${AI_ACTING_COACHING.path}`,
    title: `${AI_ACTING_COACHING.title} | Acttub`,
    description: AI_ACTING_COACHING.description,
  });
});

test("가이드 목차 metadata는 canonical과 website 공유 정보를 담는다", () => {
  const metadata = buildGuideIndexMetadata("https://example.com/");

  assert.equal(
    metadata.title,
    "연기 연습 가이드 — 독백·셀프테이프·입시·독학 루틴",
  );
  assert.equal(metadata.alternates.canonical, "/guide");
  assert.equal(metadata.openGraph.type, "website");
  assert.equal(metadata.openGraph.url, "https://example.com/guide");
});

test("랜딩 metadata에만 canonical과 openGraph URL이 있다", () => {
  const metadata = buildLandingMetadata("https://example.com/");

  assert.equal(metadata.alternates.canonical, "/");
  assert.equal(metadata.openGraph.url, "https://example.com/");
});

test("noindex metadata는 검색과 링크 추적을 모두 막는다", () => {
  assert.deepEqual(buildNoindexMetadata("로그인"), {
    title: "로그인",
    robots: { index: false, follow: false },
  });
  assert.deepEqual(buildNoindexMetadata(), {
    robots: { index: false, follow: false },
  });
});
