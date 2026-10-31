// 웹 개편(SOMA-834): 옛 연습 주소는 /app 으로, /guide 는 /blog 로 옮긴다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("연습·리딩·보관함 주소는 /app 으로, 가이드는 블로그로 옮긴다", () => {
  for (const source of ["/home", "/practice/:path*", "/reading/:path*", "/library/:path*", "/memory", "/transfer"]) {
    assert.ok(config.includes(`"${source}"`), source);
  }
  assert.match(config, /source: "\/guide", destination: "\/blog", permanent: true/);
  assert.match(config, /source: "\/guide\/:slug", destination: "\/blog\/:slug", permanent: true/);
  assert.doesNotMatch(config, /Cross-Origin-Embedder-Policy/);
});
