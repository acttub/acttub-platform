import assert from 'node:assert/strict';
import test from 'node:test';

import { keyboardOverlap } from '../lib/keyboard-overlap.ts';

const SCREEN = 2400;

test('F13: 화면 좌표로 잰 겹침이 보고된 높이보다 크면 그쪽을 쓴다', () => {
  // 보고된 높이가 내비게이션 바를 빼먹어 실제보다 작게 온 경우
  assert.equal(keyboardOverlap({ height: 900, screenY: 1400 }, SCREEN), 1000);
});

test('F13: 보고된 높이가 더 크면 그대로 쓴다', () => {
  assert.equal(keyboardOverlap({ height: 1050, screenY: 1400 }, SCREEN), 1050);
});

test('F13: screenY가 없으면 보고된 높이로 떨어진다', () => {
  assert.equal(keyboardOverlap({ height: 980 }, SCREEN), 980);
  assert.equal(keyboardOverlap({ height: 980, screenY: null }, SCREEN), 980);
});

test('F13: 키보드가 없으면 0', () => {
  assert.equal(keyboardOverlap(null, SCREEN), 0);
  assert.equal(keyboardOverlap({}, SCREEN), 0);
  assert.equal(keyboardOverlap({ height: 0, screenY: SCREEN }, SCREEN), 0);
});

test('F13: 화면 전체를 덮는 비정상 값은 무시한다', () => {
  assert.equal(keyboardOverlap({ height: SCREEN, screenY: 0 }, SCREEN), 0);
  assert.equal(keyboardOverlap({ height: 9999 }, SCREEN), 0);
});

test('F13: 음수·NaN은 없는 값으로 본다', () => {
  assert.equal(keyboardOverlap({ height: -10, screenY: 1400 }, SCREEN), 1000);
  assert.equal(keyboardOverlap({ height: Number.NaN, screenY: Number.NaN }, SCREEN), 0);
});

test('F13: 화면 높이를 모르면 보고된 높이만 쓴다', () => {
  assert.equal(keyboardOverlap({ height: 900, screenY: 1400 }, 0), 900);
});
