import assert from 'node:assert/strict';
import test from 'node:test';

const { celebrationDots, shouldCelebrateStreak } = await import('../lib/streak-celebration.ts');

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

// 전체화면 축하의 요일 점(SOMA-494). 오늘 칸만 "차오르는" 칸이고, 지난 연습일은 이미 찬 칸이다.
test('축하 화면의 요일 점 — 오늘 연습한 칸만 차오르고, 지난 연습일은 찬 채로 있다', () => {
  const days = [
    { key: 'mon', label: '월', count: 1, isToday: false, isFuture: false },
    { key: 'tue', label: '화', count: 0, isToday: false, isFuture: false },
    { key: 'wed', label: '수', count: 2, isToday: true, isFuture: false },
    { key: 'thu', label: '목', count: 0, isToday: false, isFuture: true },
  ];
  assert.deepEqual(
    celebrationDots(days).map((d) => d.state),
    ['done', 'empty', 'today', 'empty'],
  );
  assert.deepEqual(celebrationDots(days).map((d) => d.label), ['월', '화', '수', '목']);
});

test('축하 화면의 요일 점 — 오늘 연습이 아직 없으면 차오를 칸이 없다', () => {
  const days = [{ key: 'wed', label: '수', count: 0, isToday: true, isFuture: false }];
  assert.deepEqual(celebrationDots(days).map((d) => d.state), ['empty']);
});
