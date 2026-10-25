import assert from 'node:assert/strict';
import test from 'node:test';

import { kstDate, lastWeekResult, periodLabel, pickedEntries } from '../lib/challenge/week-result.ts';

const NOW = Date.parse('2026-10-19T12:00:00+09:00');
const card = (over = {}) => ({
  id: 'c1',
  line: '내가 왜 여기까지 왔는지',
  work: '작품',
  character: null,
  scene_note: null,
  origin: 'team',
  host_name: null,
  starts_at: '2026-10-09T00:00:00+09:00',
  ends_at: '2026-10-17T00:00:00+09:00',
  featured_on: null,
  moderation: 'visible',
  entry_count: 5,
  like_sum: 10,
  participants: [],
  more_count: 0,
  ...over,
});

test('지난주 결과: 끝난 지 7일 안의 공식 챌린지 중 가장 최근 것', () => {
  assert.equal(lastWeekResult([card()], NOW)?.id, 'c1');
  // 사용자 챌린지는 결과 배너에 올리지 않는다.
  assert.equal(lastWeekResult([card({ origin: 'member' })], NOW), null);
  // 7일보다 오래 끝난 것은 지난주 결과가 아니다.
  assert.equal(lastWeekResult([card({ ends_at: '2026-10-11T00:00:00+09:00' })], NOW), null);
  // 아직 진행 중이면 결과가 없다.
  assert.equal(lastWeekResult([card({ ends_at: '2026-10-20T00:00:00+09:00' })], NOW), null);
  // 참여작이 없으면 보여 줄 결과가 없다.
  assert.equal(lastWeekResult([card({ entry_count: 0 })], NOW), null);
  // 목록 순서와 상관없이 가장 늦게 끝난 것.
  const older = card({ id: 'old', ends_at: '2026-10-15T00:00:00+09:00' });
  assert.equal(lastWeekResult([older, card()], NOW)?.id, 'c1');
  assert.equal(lastWeekResult([], NOW), null);
});

test('선정작: 서버 순위 3위 안의 참여작을 순서대로 최대 셋', () => {
  const e = (id, rank) => ({ id, rank });
  assert.deepEqual(pickedEntries([e('a', 1), e('b', 2), e('c', 2), e('d', 4)]).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(pickedEntries([e('a', 1), e('b', 2), e('c', 3), e('d', 3)]).map((x) => x.id), ['a', 'b', 'c']);
  // 순위가 없으면(집계 중·좋아요 0) 선정작도 없다.
  assert.deepEqual(pickedEntries([e('a', null), e('b', null)]), []);
});

test('날짜는 한국 시간으로 센다', () => {
  assert.deepEqual(kstDate('2026-10-24T15:30:00Z'), { month: 10, day: 25, weekday: 0 });
  // 기간은 시작일부터 마감 직전 날까지.
  assert.equal(periodLabel('2026-10-09T00:00:00+09:00', '2026-10-17T00:00:00+09:00'), '10/9~10/16');
});
