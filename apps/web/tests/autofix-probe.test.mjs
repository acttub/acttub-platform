import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { familyInitial } = await import("../src/lib/autofix-probe.ts");

test("familyInitial은 두 번째 단어의 첫 글자를 돌려준다", () => {
  assert.equal(familyInitial("Gildong Hong"), "H");
});

test("familyInitial은 공백 없는 이름에서 던지지 않고 빈 문자열을 돌려준다", () => {
  assert.equal(familyInitial("홍길동"), "");
});
