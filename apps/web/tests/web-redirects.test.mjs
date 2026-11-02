// 웹 개편(SOMA-834): 웹에서도 연습(체험)을 하므로 연습 주소는 그대로 두고, /guide 만 /blog 로 옮긴다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("연습·리딩·보관함 주소는 앱 안내로 보내지 않고, 가이드는 블로그로 옮긴다", () => {
  assert.doesNotMatch(config, /destination: "\/app"/);
  assert.match(config, /source: "\/guide", destination: "\/blog", permanent: true/);
  assert.match(config, /source: "\/guide\/:slug", destination: "\/blog\/:slug", permanent: true/);
  // 리딩은 브라우저 안 음성 합성에 교차 출처 격리가 필요하다.
  assert.match(config, /source: "\/reading",\s*headers/);
  assert.match(config, /Cross-Origin-Embedder-Policy/);
});
