// SOMA-1087: 웹에서는 코칭·리딩을 하지 않는다. 연습 주소는 /app 으로 임시 이동하고, /guide 는 블로그로 옮긴다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("연습·리딩·보관함 주소는 /app 으로 임시 이동하고, 가이드는 블로그로 옮긴다", () => {
  for (const source of ["/reading", "/reading/:path*", "/practice", "/practice/:path*", "/home", "/library", "/library/:path*", "/memory"]) {
    assert.ok(config.includes(`"${source}"`), source);
  }
  assert.match(config, /destination: "\/app", permanent: false/);
  assert.doesNotMatch(config, /destination: "\/app", permanent: true/);
  assert.match(config, /source: "\/guide", destination: "\/blog", permanent: true/);
  assert.match(config, /source: "\/guide\/:slug", destination: "\/blog\/:slug", permanent: true/);
});
