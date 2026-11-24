import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { LANDING_INTRO_HREF } = await import("../src/lib/landing-intro.ts");

test("연습 화면 로고는 intro=1 을 단 랜딩 주소를 가리킨다", () => {
  assert.equal(new URL(LANDING_INTRO_HREF, "https://acttub.com").search, "?intro=1");
});

test("랜딩은 게스트를 /home 으로 넘기지 않는다", () => {
  const src = readFileSync(new URL("../src/app/landing-client.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /router\.replace|useRouter/);
});
