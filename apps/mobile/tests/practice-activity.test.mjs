import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecentActivity } from '../lib/practice-activity.ts';

/** 로컬 자정 기준으로 Date를 만든다(테스트가 실행 타임존에 흔들리지 않게). */
function local(y, m, d, h = 12) {
  return new Date(y, m - 1, d, h);
}

test('홈 최근 7일: 오늘이 맨 오른쪽이고 앞 6일이 왼쪽으로 이어지며 요일 이름은 날짜를 따른다', () => {
  // 2026-07-29는 수요일
  const { days } = buildRecentActivity(
    [{ created_at: local(2026, 7, 24).toISOString() }, { created_at: local(2026, 7, 29, 9).toISOString() }, { created_at: local(2026, 7, 22).toISOString() }],
    local(2026, 7, 29),
  );

  assert.deepEqual(days.map((d) => d.label), ['목', '금', '토', '일', '월', '화', '수']);
  assert.deepEqual(days.map((d) => d.key), ['2026-7-23', '2026-7-24', '2026-7-25', '2026-7-26', '2026-7-27', '2026-7-28', '2026-7-29']);
  assert.deepEqual(days.map((d) => d.count), [0, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual(days.map((d) => d.isToday), [false, false, false, false, false, false, true]);
  assert.ok(days.every((d) => !d.isFuture));
});

test('홈 최근 7일: 같은 날 여러 번 연습하면 그 날의 count로 합산된다', () => {
  const { days } = buildRecentActivity(
    [
      { created_at: local(2026, 7, 27, 9).toISOString() },
      { created_at: local(2026, 7, 27, 21).toISOString() },
      { created_at: local(2026, 7, 29, 10).toISOString() },
    ],
    local(2026, 7, 29),
  );

  assert.deepEqual(days.map((d) => d.count), [0, 0, 0, 0, 2, 0, 1]);
});

test('홈 최근 7일: 달이 바뀌는 날도 하루씩 이어진다', () => {
  const { days } = buildRecentActivity([], local(2026, 8, 2));

  assert.deepEqual(days.map((d) => d.key), ['2026-7-27', '2026-7-28', '2026-7-29', '2026-7-30', '2026-7-31', '2026-8-1', '2026-8-2']);
});

test('홈 최근 7일: 잘못된 created_at은 무시한다', () => {
  const { days } = buildRecentActivity(
    [{ created_at: 'not-a-date' }, { created_at: local(2026, 7, 29).toISOString() }],
    local(2026, 7, 29),
  );

  assert.deepEqual(days.map((d) => d.count), [0, 0, 0, 0, 0, 0, 1]);
});
