// 공개 홈 데스크톱 "멈춘 뒤 맞춤": 구간 윗부분이 가까이 걸쳐 있을 때만 그 구간에 맞춘다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { settleTarget } = await import("../src/features/site/scroll-settle.ts");

test("가까운 구간 시작이 범위 안이면 그 자리로 맞춘다(위·아래 모두)", () => {
  const pts = [0, 828, 1700, 2600];
  assert.equal(settleTarget(pts, 760, 250, 5000), 828);
  assert.equal(settleTarget(pts, 900, 250, 5000), 828);
  assert.equal(settleTarget(pts, 1500, 250, 5000), 1700);
});

test("멀리 떨어졌거나 이미 맞으면 건드리지 않는다", () => {
  const pts = [0, 828, 1700];
  assert.equal(settleTarget(pts, 1250, 250, 5000), null);
  assert.equal(settleTarget(pts, 829, 250, 5000), null);
  assert.equal(settleTarget([], 100, 250, 5000), null);
});

test("맞출 자리는 스크롤 끝을 넘지 않는다", () => {
  assert.equal(settleTarget([0, 4980], 4800, 250, 4900), 4900);
});

test("방금 맞춰 있던 자리에서 조금씩 벗어나는 중이면 그 자리로 되돌리지 않는다", () => {
  const pts = [0, 828, 1700];
  assert.equal(settleTarget(pts, 948, 165, 5000, 828), null);
  assert.equal(settleTarget(pts, 708, 165, 5000, 828), null);
  // 맞춰 있던 자리가 없으면(다른 곳에서 와서 살짝 지나침) 되돌려 맞춘다.
  assert.equal(settleTarget(pts, 948, 165, 5000, null), 828);
  // 벗어나는 중이어도 다음 구간이 가까우면 그쪽으로 맞춘다.
  assert.equal(settleTarget(pts, 1600, 165, 5000, 828), 1700);
});
