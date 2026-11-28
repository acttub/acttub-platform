// 웹의 코칭·리딩·연습 기능은 없앴다(SOMA-1087 뒤 코드까지 삭제). 옛 연습 주소는 /app 으로 영구 이동하고,
// /guide 는 블로그로 옮긴다. 리딩 전용이던 교차 출처 격리 헤더도 함께 없앴다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("연습·리딩·보관함 주소는 /app 으로 영구 이동하고, 가이드는 블로그로 옮긴다", () => {
  for (const source of ["/reading", "/reading/:path*", "/practice", "/practice/:path*", "/home", "/library", "/library/:path*", "/memory"]) {
    assert.ok(config.includes(`"${source}"`), source);
  }
  assert.match(config, /destination: "\/app", permanent: true/);
  assert.doesNotMatch(config, /destination: "\/app", permanent: false/);
  assert.match(config, /source: "\/guide", destination: "\/blog", permanent: true/);
  assert.match(config, /source: "\/guide\/:slug", destination: "\/blog\/:slug", permanent: true/);
});

test("옛 연습 주소의 화면 파일과 리딩 전용 헤더·rewrite 는 남아 있지 않다", () => {
  for (const route of ["home", "library", "memory", "practice", "reading"]) {
    assert.equal(existsSync(new URL(`../src/app/${route}`, import.meta.url)), false, route);
  }
  assert.doesNotMatch(config, /Cross-Origin-(Opener|Embedder)-Policy/);
  assert.doesNotMatch(config, /destination: "\/(reading\/scripts|library)"/);
});
