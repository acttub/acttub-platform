// 공개 홈 데스크톱 부드러운 휠: 입력만큼 목표를 옮기고 화면은 프레임마다 남은 거리를 따라간다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { followScroll, wheelPixels } = await import("../src/features/site/smooth-wheel.ts");

test("줄·쪽 단위 휠 값을 px 로 바꾼다", () => {
  assert.equal(wheelPixels(100, 0, 900), 100);
  assert.equal(wheelPixels(3, 1, 900), 48);
  assert.equal(wheelPixels(1, 2, 900), 900);
});

test("한 프레임에 남은 거리의 10% 를 따라가고, 거의 닿으면 목표에 붙는다", () => {
  assert.equal(Math.round(followScroll(0, 1000, 1000 / 60)), 100);
  // 30fps 한 프레임은 60fps 두 프레임과 같은 거리
  assert.equal(Math.round(followScroll(0, 1000, 2000 / 60)), 190);
  assert.equal(followScroll(999.7, 1000, 16), 1000);
  assert.equal(followScroll(500, 500, 16), 500);
});
