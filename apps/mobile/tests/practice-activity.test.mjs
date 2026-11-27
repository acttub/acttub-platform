import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecentActivity, practiceFillPercent, withPracticeCounts } from '../lib/practice-activity.ts';

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

test('원 높이: 1번 30%, 2번 55%, 3~4번 80%, 5번 이상 100%, 없으면 0', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(practiceFillPercent), [0, 30, 55, 80, 80, 100, 100]);
});

test('날마다 횟수: 연습한 날이면 최소 1, 센 연습 기록이 더 많으면 그 수', () => {
  const now = local(2026, 7, 29);
  // 하루 하나로 합친 날짜 — 7/24(센 기록 없음, 기기에 남은 날), 7/27, 오늘 7/29.
  const { days } = buildRecentActivity(
    [{ created_at: local(2026, 7, 24).toISOString() }, { created_at: local(2026, 7, 27).toISOString() }, { created_at: local(2026, 7, 29).toISOString() }],
    now,
  );
  const practices = [
    { at: local(2026, 7, 27, 9).toISOString() },
    { at: local(2026, 7, 27, 13).toISOString() },
    { at: local(2026, 7, 27, 21).toISOString() },
    { at: local(2026, 7, 29, 8).toISOString() },
    { at: local(2026, 7, 29, 23).toISOString() },
    { at: 'not-a-date' },
    { at: local(2026, 7, 20).toISOString() }, // 7일 밖
  ];

  const counted = withPracticeCounts(days, practices);

  assert.deepEqual(counted.map((d) => d.count), [0, 1, 0, 0, 3, 0, 2]);
  assert.deepEqual(counted.map((d) => d.key), days.map((d) => d.key));
  assert.equal(counted[6].isToday, true);
});

test('날마다 횟수: 연습 없는 오늘과 빈 날은 0이다', () => {
  const { days } = buildRecentActivity([], local(2026, 7, 29));

  const counted = withPracticeCounts(days, []);

  assert.deepEqual(counted.map((d) => d.count), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(counted[6].isToday, true);
});

test('날마다 횟수: 날짜 목록에 없어도 그 날 센 기록이 있으면 센다', () => {
  const { days } = buildRecentActivity([], local(2026, 7, 29));

  const counted = withPracticeCounts(days, [{ at: local(2026, 7, 28, 10).toISOString() }]);

  assert.deepEqual(counted.map((d) => d.count), [0, 0, 0, 0, 0, 1, 0]);
});
