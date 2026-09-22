import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLE_GAP,
  HOLE_PADDING,
  captionTop,
  holeOf,
  shroudRects,
  spotlightKey,
  stepAfter,
} from '../lib/guide-spotlight.ts';

/**
 * 스포트라이트 가이드의 자리 계산 (SOMA-550).
 *
 * <p>비출 자리를 뺀 나머지를 검정 사각형 넷으로 덮는다. 계산만 여기서 시험한다 — 화면은
 * 실기기에서 본다.
 */

const SCREEN = { width: 390, height: 844 };

test('비출 자리는 손가락이 닿을 여유만큼 넓힌다', () => {
  const hole = holeOf({ x: 100, y: 200, width: 60, height: 40 }, SCREEN);
  assert.deepEqual(hole, {
    x: 100 - HOLE_PADDING,
    y: 200 - HOLE_PADDING,
    width: 60 + HOLE_PADDING * 2,
    height: 40 + HOLE_PADDING * 2,
  });
});

test('넓힌 자리가 화면을 넘어가면 화면 안으로 자른다', () => {
  const hole = holeOf({ x: 0, y: 0, width: 390, height: 40 }, SCREEN);
  assert.equal(hole.x, 0);
  assert.equal(hole.y, 0);
  assert.equal(hole.width, SCREEN.width);
  assert.equal(hole.height, 40 + HOLE_PADDING);
});

test('비출 자리가 없으면 화면 전체를 덮는다', () => {
  assert.equal(holeOf(null, SCREEN), null);
  const shroud = shroudRects(null, SCREEN);
  assert.equal(shroud.length, 1);
  assert.deepEqual(shroud[0], { x: 0, y: 0, width: 390, height: 844 });
});

test('네 조각이 비출 자리를 뺀 나머지를 빈틈없이 덮는다', () => {
  const hole = { x: 100, y: 200, width: 80, height: 50 };
  const shroud = shroudRects(hole, SCREEN);
  assert.equal(shroud.length, 4);
  const covered = shroud.reduce((sum, r) => sum + r.width * r.height, 0);
  assert.equal(covered, SCREEN.width * SCREEN.height - hole.width * hole.height);
  // 조각끼리 겹치지 않는다 — 반투명 검정이 겹치면 그 자리만 진해진다.
  for (let i = 0; i < shroud.length; i += 1) {
    for (let j = i + 1; j < shroud.length; j += 1) {
      const a = shroud[i];
      const b = shroud[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(overlapX <= 0 || overlapY <= 0, `${i}번과 ${j}번이 겹친다`);
    }
  }
});

test('비출 자리가 화면 가장자리에 붙으면 빈 조각은 버린다', () => {
  const shroud = shroudRects({ x: 0, y: 0, width: 390, height: 60 }, SCREEN);
  assert.equal(shroud.length, 1);
  assert.deepEqual(shroud[0], { x: 0, y: 60, width: 390, height: 784 });
});

test('설명은 비출 자리 아래에 붙인다', () => {
  const top = captionTop({ x: 0, y: 100, width: 390, height: 60 }, SCREEN, 160);
  assert.equal(top, 100 + 60 + HOLE_GAP);
});

test('아래가 모자라면 설명을 위로 올린다 — 비출 자리를 가리지 않는다', () => {
  const hole = { x: 0, y: 700, width: 390, height: 60 };
  const top = captionTop(hole, SCREEN, 160);
  assert.equal(top, 700 - HOLE_GAP - 160);
  assert.ok(top + 160 <= hole.y);
});

test('위아래 모두 모자라면 화면 안에 붙여 둔다', () => {
  const top = captionTop({ x: 0, y: 20, width: 390, height: 800 }, SCREEN, 300);
  assert.ok(top >= 0);
  assert.ok(top + 300 <= SCREEN.height);
});

test('마지막 단계 다음은 끝이다', () => {
  assert.equal(stepAfter(0, 2), 1);
  assert.equal(stepAfter(1, 2), null);
});

test('화면마다 따로 기억한다 — 홈을 봤다고 대본 가이드가 사라지지 않는다', () => {
  assert.notEqual(spotlightKey('home'), spotlightKey('reading'));
  assert.ok(spotlightKey('home').includes('home'));
});
