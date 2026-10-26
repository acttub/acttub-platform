// 공개 홈 데스크톱 "멈춘 뒤 맞춤": 반쯤 걸린 채 멈추면 가던 방향으로 칸 시작에 맞춘다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { settleTarget } = await import("../src/features/site/scroll-settle.ts");
const PTS = [0, 800, 1600, 2400];

test("아래로 가다 칸 높이의 15% 넘게 움직였으면 다음 칸, 덜 움직였으면 원래 칸", () => {
  assert.equal(settleTarget(PTS, 950, 1, 800, 9000), 1600);
  assert.equal(settleTarget(PTS, 880, 1, 800, 9000), 800);
});

test("위로 가다 15% 넘게 움직였으면 이전 칸, 덜 움직였으면 원래 칸", () => {
  assert.equal(settleTarget(PTS, 1450, -1, 800, 9000), 800);
  assert.equal(settleTarget(PTS, 1550, -1, 800, 9000), 1600);
});

test("이미 맞거나 방향을 모르면 가까운 쪽", () => {
  assert.equal(settleTarget(PTS, 801, 1, 800, 9000), null);
  assert.equal(settleTarget(PTS, 1100, 0, 800, 9000), 800);
  assert.equal(settleTarget(PTS, 1300, 0, 800, 9000), 1600);
  assert.equal(settleTarget([], 100, 1, 800, 9000), null);
});

test("화면보다 훨씬 긴 칸과 마지막 칸은 경계 가까이에서만 맞춘다", () => {
  const pts = [0, 800, 3000];
  assert.equal(settleTarget(pts, 1500, 1, 800, 9000), null);
  assert.equal(settleTarget(pts, 900, 1, 800, 9000), 800);
  assert.equal(settleTarget(pts, 2850, 1, 800, 9000), 3000);
  assert.equal(settleTarget(pts, 3100, 1, 800, 9000), 3000);
  assert.equal(settleTarget(pts, 4000, 1, 800, 9000), null);
});
