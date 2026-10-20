// 연습 영상 타임코드를 초로 바꾼다. 콜론 없는 입력은 초 값으로 본다(Sentry ACTTUB-WEB-Q).
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { timecodeToSeconds } = await import("../src/lib/autofix-probe.ts");

test("분:초 타임코드를 초로 바꾼다", () => {
  assert.equal(timecodeToSeconds("1:05"), 65);
});

test("콜론 없는 타임코드는 초 값으로 본다", () => {
  assert.equal(timecodeToSeconds("90"), 90);
});
