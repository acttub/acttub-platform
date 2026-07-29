import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeekActivity, weekColorStep } from '../lib/practice-activity.ts';

/** 로컬 자정 기준으로 Date를 만든다(테스트가 실행 타임존에 흔들리지 않게). */
function local(y, m, d, h = 12) {
  return new Date(y, m - 1, d, h);
}

test('F4: 이번 주 월요일부터 7일치를 월화수목금토일 순서로 만든다', () => {
  // 2026-07-29는 수요일
  const { days } = buildWeekActivity([], local(2026, 7, 29));

  assert.deepEqual(
    days.map((d) => d.label),
    ['월', '화', '수', '목', '금', '토', '일'],
  );
  assert.deepEqual(
    days.map((d) => d.key),
    ['2026-7-27', '2026-7-28', '2026-7-29', '2026-7-30', '2026-7-31', '2026-8-1', '2026-8-2'],
  );
});

test('F4: 오늘 이후의 날은 isFuture로 표시하고 횟수를 세지 않는다', () => {
  const { days, weekTotal } = buildWeekActivity(
    [{ created_at: local(2026, 7, 31).toISOString() }], // 이번 주지만 미래(금)
    local(2026, 7, 29),
  );

  assert.deepEqual(
    days.map((d) => d.isFuture),
    [false, false, false, true, true, true, true],
  );
  assert.equal(weekTotal, 0);
});

test('F4: 같은 날 여러 번 연습하면 그 날의 count로 합산되고 주간 합계에 반영된다', () => {
  const { days, weekTotal } = buildWeekActivity(
    [
      { created_at: local(2026, 7, 27, 9).toISOString() },
      { created_at: local(2026, 7, 27, 21).toISOString() },
      { created_at: local(2026, 7, 29, 10).toISOString() },
    ],
    local(2026, 7, 29),
  );

  assert.deepEqual(
    days.map((d) => d.count),
    [2, 0, 1, 0, 0, 0, 0],
  );
  assert.equal(weekTotal, 3);
});

test('F4: 오늘만 isToday다', () => {
  const { days } = buildWeekActivity([], local(2026, 7, 29));

  assert.deepEqual(
    days.map((d) => d.isToday),
    [false, false, true, false, false, false, false],
  );
});

test('F4: 지난 주 기록은 이번 주 스트립에 들어가지 않는다', () => {
  const { days, weekTotal } = buildWeekActivity(
    [{ created_at: local(2026, 7, 26).toISOString() }], // 직전 일요일
    local(2026, 7, 29),
  );

  assert.equal(weekTotal, 0);
  assert.deepEqual(
    days.map((d) => d.count),
    [0, 0, 0, 0, 0, 0, 0],
  );
});

test('F4: 오늘 안 했어도 어제까지 이어진 연속일은 유지된다', () => {
  const { streak } = buildWeekActivity(
    [
      { created_at: local(2026, 7, 28).toISOString() },
      { created_at: local(2026, 7, 27).toISOString() },
    ],
    local(2026, 7, 29),
  );

  assert.equal(streak, 2);
});

test('F4: 연속이 끊기면 거기서 멈춘다', () => {
  const { streak } = buildWeekActivity(
    [
      { created_at: local(2026, 7, 29).toISOString() },
      { created_at: local(2026, 7, 27).toISOString() }, // 28일 빠짐
    ],
    local(2026, 7, 29),
  );

  assert.equal(streak, 1);
});

test('F4: 잘못된 created_at은 무시한다', () => {
  const { weekTotal, streak } = buildWeekActivity(
    [{ created_at: 'not-a-date' }, { created_at: local(2026, 7, 29).toISOString() }],
    local(2026, 7, 29),
  );

  assert.equal(weekTotal, 1);
  assert.equal(streak, 1);
});

test('F4: 연습 횟수를 색 단계(0/1/2~3/4~5/6+)로 접는다', () => {
  assert.equal(weekColorStep(0), 0);
  assert.equal(weekColorStep(1), 1);
  assert.equal(weekColorStep(2), 2);
  assert.equal(weekColorStep(3), 2);
  assert.equal(weekColorStep(4), 3);
  assert.equal(weekColorStep(5), 3);
  assert.equal(weekColorStep(6), 4);
  assert.equal(weekColorStep(99), 4);
});

test('F4: 음수·비정상 값은 0단계', () => {
  assert.equal(weekColorStep(-1), 0);
  assert.equal(weekColorStep(NaN), 0);
});
