import assert from 'node:assert/strict';
import test from 'node:test';

const { celebrationDots, shouldCelebrateStreak, streakCelebrationStep } = await import('../lib/streak-celebration.ts');

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

// 기록을 받기 전(연속일이 잠깐 0)에 "마지막으로 본 값"을 0으로 덮으면, 기록이 오는 순간
// 0→n 으로 늘었다고 보고 앱을 켤 때마다 축하가 다시 뜬다(실기기에서 걸림, SOMA-494).
test('기록을 받기 전에는 축하하지도 저장하지도 않는다', () => {
  assert.deepEqual(streakCelebrationStep({ loaded: false, lastSeen: 1, current: 0 }), {
    celebrate: false,
    remember: null,
  });
});

test('기록을 받은 뒤 늘었으면 축하하고 새 값을 기억한다', () => {
  assert.deepEqual(streakCelebrationStep({ loaded: true, lastSeen: 0, current: 1 }), {
    celebrate: true,
    remember: 1,
  });
});

test('같은 값이면 조용하고, 끊겨 줄었으면 줄어든 값만 기억한다', () => {
  assert.deepEqual(streakCelebrationStep({ loaded: true, lastSeen: 1, current: 1 }), {
    celebrate: false,
    remember: 1,
  });
  assert.deepEqual(streakCelebrationStep({ loaded: true, lastSeen: 5, current: 0 }), {
    celebrate: false,
    remember: 0,
  });
});
