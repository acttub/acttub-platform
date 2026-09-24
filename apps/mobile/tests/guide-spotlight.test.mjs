import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLE_GAP,
  HOLE_PADDING,
  captionPlacement,
  holeOf,
  rectStyle,
  relativeTo,
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

test('화면에 놓을 때는 자리 이름이 left·top 이다 — x·y 는 조용히 무시된다', () => {
  const style = rectStyle({ x: 12, y: 238, width: 387, height: 93 });
  assert.deepEqual(style, { left: 12, top: 238, width: 387, height: 93 });
  assert.equal('x' in style, false);
  assert.equal('y' in style, false);
});

test('덮개 판의 원점만큼 빼서 같은 기준으로 맞춘다', () => {
  // 실기기에서 판의 원점이 창 기준으로 -28.19 였고, 구멍이 딱 그만큼 위로 밀려 있었다.
  const moved = relativeTo({ x: 20, y: 245.71, width: 371, height: 77 }, { x: 0, y: -28.19 });
  assert.equal(moved.y, 245.71 + 28.19);
  assert.equal(moved.x, 20);
  assert.equal(moved.width, 371);
  // 원점이 같으면 아무것도 바뀌지 않는다.
  assert.deepEqual(relativeTo({ x: 5, y: 6, width: 7, height: 8 }, { x: 0, y: 0 }), {
    x: 5,
    y: 6,
    width: 7,
    height: 8,
  });
  assert.equal(relativeTo(null, { x: 0, y: -28 }), null);
});

test('마지막 단계 다음은 끝이다', () => {
  assert.equal(stepAfter(0, 2), 1);
  assert.equal(stepAfter(1, 2), null);
});

test('화면마다 따로 기억한다 — 홈을 봤다고 대본 가이드가 사라지지 않는다', () => {
  assert.notEqual(spotlightKey('home'), spotlightKey('reading'));
  assert.ok(spotlightKey('home').includes('home'));
});

// 설명 카드 자리(SOMA-494). 카드 높이는 그린 뒤에야 알고, 단계마다 바뀐다. 위로 놓을 때
// 높이로 윗변을 계산하면 높이를 다시 잴 때마다 카드가 움직여 누르려던 버튼이 빗나간다 —
// 실기기에서 두 번 걸렸다. 그래서 구멍 쪽 모서리를 붙인다: 아래면 윗변, 위면 아랫변.
test('아래에 자리가 있으면 카드 윗변을 구멍 아래에 붙인다', () => {
  const hole = { x: 0, y: 100, width: 390, height: 60 };
  assert.deepEqual(captionPlacement(hole, SCREEN, 160), { top: 100 + 60 + HOLE_GAP });
});

test('위로 놓을 땐 카드 아랫변을 구멍 위에 붙인다 — 카드 높이가 바뀌어도 그 자리다', () => {
  const hole = { x: 0, y: 700, width: 390, height: 60 };
  const a = captionPlacement(hole, SCREEN, 160);
  const b = captionPlacement(hole, SCREEN, 220);
  assert.deepEqual(a, { bottom: SCREEN.height - (700 - HOLE_GAP) });
  assert.deepEqual(b, a);
});

test('양쪽 다 모자라면 넓은 쪽에 두되 화면 밖으로 나가지 않는다', () => {
  // 위가 더 넓다 — 아랫변을 붙이되 카드 높이만큼은 화면 안에 남긴다.
  const tallLow = { x: 0, y: 150, width: 390, height: 640 };
  assert.deepEqual(captionPlacement(tallLow, SCREEN, 300), { bottom: SCREEN.height - 300 });
  // 아래가 더 넓다 — 윗변을 붙이되 화면 아래로 넘치지 않게 올린다.
  const tallHigh = { x: 0, y: 20, width: 390, height: 700 };
  assert.deepEqual(captionPlacement(tallHigh, SCREEN, 300), { top: SCREEN.height - 300 });
});

test('비출 자리를 아직 못 쟀으면 가운데에 둔다', () => {
  assert.deepEqual(captionPlacement(null, SCREEN, 200), { top: (SCREEN.height - 200) / 2 });
});
