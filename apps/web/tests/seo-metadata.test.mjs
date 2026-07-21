import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  buildLandingMetadata,
  buildNoindexMetadata,
  buildRootMetadata,
  resolveSiteUrl,
} = await import("../src/lib/seo/site-metadata.ts");

const description =
  "내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연습 도구예요.";

test("사이트 URL은 기본값과 정상 http(s) 주소를 정규화한다", () => {
  assert.equal(resolveSiteUrl(), "https://acttub.com");
  assert.equal(resolveSiteUrl("https://example.com"), "https://example.com");
  assert.equal(resolveSiteUrl("http://example.com/path/"), "http://example.com/path");
  assert.equal(
    resolveSiteUrl("https://example.com/path///"),
    "https://example.com/path",
  );
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
    default: "Acttub — 질문으로 다시 보는 연기 연습",
    template: "%s | Acttub",
  });
  assert.equal(metadata.description, description);
  assert.deepEqual(metadata.openGraph, {
    siteName: "Acttub",
    locale: "ko_KR",
    type: "website",
  });
  assert.deepEqual(metadata.twitter, { card: "summary_large_image" });
  assert.equal(metadata.alternates, undefined);
  assert.equal("url" in metadata.openGraph, false);
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
