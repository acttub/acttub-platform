// 이름 머리글자 — 공백이 겹치거나 앞뒤에 있어도, 빈 이름이어도 던지지 않는다(Sentry ACTTUB-WEB-M).
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { initials } = await import("../src/lib/autofix-probe.ts");

test("단어마다 첫 글자를 대문자로 잇는다", () => {
  assert.equal(initials("jane doe"), "JD");
});

test("겹친 공백과 앞뒤 공백은 건너뛴다", () => {
  assert.equal(initials("  jane   doe "), "JD");
});

test("빈 이름은 빈 문자열이다", () => {
  assert.equal(initials(""), "");
});
