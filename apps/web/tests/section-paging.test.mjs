// 공개 홈 데스크톱 구간 넘김: 한 번 내리면 다음 구간 자리로, 긴 구간은 끝까지 평소처럼 내려간다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { isNewSwipe, pagingTarget, snapPoints } = await import("../src/features/site/section-paging.ts");

test("멈출 자리는 0 과 끝 사이로 자르고, 끝(바닥)을 더하고, 겹치면 하나로 친다", () => {
  assert.deepEqual(snapPoints([1, 829, 829.4, 1657, 5200], 4924), [1, 829, 1657, 4924]);
  assert.deepEqual(snapPoints([-30], 0), [0]);
});

test("내리면 다음 구간 시작으로, 올리면 이전 구간 시작으로 간다", () => {
  const pts = [0, 828, 1656, 2484];
  assert.equal(pagingTarget(pts, 0, 1, 828), 828);
  assert.equal(pagingTarget(pts, 828, 1, 828), 1656);
  assert.equal(pagingTarget(pts, 1656, -1, 828), 828);
  assert.equal(pagingTarget(pts, 0, -1, 828), null);
  assert.equal(pagingTarget(pts, 2484, 1, 828), null);
});

test("구간 중간에서 올리면 그 구간 시작으로 맞춘다", () => {
  assert.equal(pagingTarget([0, 828, 1656], 900, -1, 828), 828);
});

test("화면보다 긴 구간은 끝에 닿기 전까지 평소 스크롤에 맡긴다", () => {
  const pts = [0, 828, 2000, 2600];
  assert.equal(pagingTarget(pts, 828, 1, 828), "native");
  assert.equal(pagingTarget(pts, 1172, 1, 828), 2000);
  assert.equal(pagingTarget(pts, 1100, -1, 828), "native");
  assert.equal(pagingTarget([], 0, 1, 828), null);
});

test("넘긴 뒤 줄어드는 관성은 새 손짓이 아니고, 확 커지면 다시 민 것이다", () => {
  assert.equal(isNewSwipe(40, 45), false);
  assert.equal(isNewSwipe(12, 6), false);
  assert.equal(isNewSwipe(35, 6), true);
  assert.equal(isNewSwipe(80, Infinity), false);
});
