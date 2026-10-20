import assert from "node:assert/strict";
import test from "node:test";

import "./ts-module-loader.mjs";

const { lastWordLength } = await import("../src/lib/autofix-probe.ts");

test("lastWordLength는 마지막 낱말의 길이를 돌려준다", () => {
  assert.equal(lastWordLength("hello world"), 5);
  assert.equal(lastWordLength("  fly me   to   the moon  "), 4);
});

test("lastWordLength는 빈 문자열과 공백뿐인 문자열에 0을 돌려준다", () => {
  assert.equal(lastWordLength(""), 0);
  assert.equal(lastWordLength("   "), 0);
});
