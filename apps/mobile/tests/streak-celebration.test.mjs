import assert from 'node:assert/strict';
import test from 'node:test';

const { shouldCelebrateStreak } = await import('../lib/streak-celebration.ts');

test('SOMA-479: 오늘 연속일이 늘면 축하한다', () => {
  assert.equal(shouldCelebrateStreak(2, 3), true);
});

test('SOMA-479: 첫 연속일(0→1)도 축하한다', () => {
  assert.equal(shouldCelebrateStreak(0, 1), true);
});

test('SOMA-479: 같은 값으로 다시 들어오면 축하하지 않는다', () => {
  assert.equal(shouldCelebrateStreak(3, 3), false);
});

test('SOMA-479: 연속이 끊겨 줄면 축하하지 않는다', () => {
  assert.equal(shouldCelebrateStreak(5, 1), false);
  assert.equal(shouldCelebrateStreak(5, 0), false);
});

test('SOMA-479: 아직 0연속이면(오늘 연습 전) 축하하지 않는다', () => {
  assert.equal(shouldCelebrateStreak(0, 0), false);
});

test('SOMA-479: 저장값이 깨져도(NaN) 0으로 보고 판정한다', () => {
  assert.equal(shouldCelebrateStreak(Number.NaN, 1), true);
});
