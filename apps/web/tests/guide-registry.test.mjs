import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { ACTING_COACHING } = await import(
  "../src/features/keyword-pages/content/acting-coaching.ts"
);
const { AI_ACTING_COACHING } = await import(
  "../src/features/keyword-pages/content/ai-acting-coaching.ts"
);
const { GUIDES, findGuide, guideSlug } = await import(
  "../src/features/keyword-pages/content/guide/index.ts"
);

test("가이드 레지스트리는 여덟 글의 경로와 필수 내용을 보장한다", () => {
  assert.equal(GUIDES.length, 8);

  const slugs = GUIDES.map(guideSlug);
  assert.equal(new Set(slugs).size, GUIDES.length);

  for (const guide of GUIDES) {
    assert.match(guide.path, /^\/guide\//);
    assert.match(guide.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(guide.faq.length, 0);
    assert.equal(findGuide(guideSlug(guide)), guide);
  }

  assert.equal(findGuide("missing-guide"), null);
});

test("필러와 가이드의 관련 링크는 실제 공개 경로만 가리킨다", () => {
  const allowedPaths = new Set([
    "/",
    "/app",
    "/terms",
    "/admissions",
    "/ai-acting-coaching",
    "/acting-coaching",
    "/guide",
    ...GUIDES.map((guide) => guide.path),
  ]);

  for (const content of [AI_ACTING_COACHING, ACTING_COACHING, ...GUIDES]) {
    for (const related of content.related) {
      assert.equal(
        allowedPaths.has(related.href),
        true,
        `${content.path}: ${related.href}`,
      );
    }
  }
});

test("랜딩·입시요강 상세의 가이드 바로가기는 실제 가이드 글만 가리킨다", async () => {
  const { LANDING_GUIDE_LINKS, ADMISSIONS_GUIDE_LINKS } = await import(
    "../src/features/keyword-pages/guide-links.ts"
  );
  const guidePaths = new Set(GUIDES.map((guide) => guide.path));

  for (const links of [LANDING_GUIDE_LINKS, ADMISSIONS_GUIDE_LINKS]) {
    assert.notEqual(links.length, 0);
    assert.equal(new Set(links.map((link) => link.href)).size, links.length);
    for (const link of links) {
      assert.equal(guidePaths.has(link.href), true, link.href);
      assert.notEqual(link.label.trim(), "");
    }
  }
});
