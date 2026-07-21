import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

// 셸/CI에 NEXT_PUBLIC_SITE_URL이 설정돼 있어도 기본값 검증이 결정적이어야 한다.
delete process.env.NEXT_PUBLIC_SITE_URL;

const { default: robots } = await import("../src/app/robots.ts");
const { default: sitemap } = await import("../src/app/sitemap.ts");

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

test("sitemap은 랜딩 URL 하나만 반환한다", () => {
  assert.deepEqual(sitemap(), [{ url: "https://acttub.com/" }]);
});
