import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { LANDING_INTRO_HREF, wantsLandingIntro } = await import("../src/lib/landing-intro.ts");

test("intro=1 이 있을 때만 게스트에게 랜딩을 보여 준다", () => {
  assert.equal(wantsLandingIntro("?intro=1"), true);
  assert.equal(wantsLandingIntro("?utm_source=ig&intro=1"), true);
  assert.equal(wantsLandingIntro(""), false);
  assert.equal(wantsLandingIntro("?intro=0"), false);
  assert.equal(wantsLandingIntro("?utm_source=ig"), false);
  assert.equal(new URL(LANDING_INTRO_HREF, "https://acttub.com").search, "?intro=1");
});

test("랜딩은 intro 표시가 없을 때만 게스트를 /home 으로 보낸다", () => {
  const src = readFileSync(new URL("../src/app/landing-client.tsx", import.meta.url), "utf8");
  assert.match(src, /hasGuestSession\(\) && !wantsLandingIntro\(window\.location\.search\)/);
});

test("연습 화면 목록 로고는 랜딩 소개로 이어진다", () => {
  const src = readFileSync(new URL("../src/features/workspace/workspace-app.tsx", import.meta.url), "utf8");
  assert.match(src, /<Link href=\{LANDING_INTRO_HREF\}[^>]*>\s*<Image src=\{wordmark\}/);
});
