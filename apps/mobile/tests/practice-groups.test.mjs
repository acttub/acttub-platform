import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterGroups,
  groupTitle,
  hideNotice,
  kstDayKey,
  mergeHistoryRows,
  practiceStreak,
  recentGroups,
  roundSummary,
} from '../lib/practice/groups.ts';

const group = (over = {}) => ({
  root_id: 'root-1',
  title: null,
  note_title: null,
  situation: null,
  ordinal_count: 1,
  in_progress_practice_id: null,
  favorite: false,
  hidden_at: null,
  last_practiced_at: '2026-09-20T02:00:00Z',
  ...over,
});

test('practice.library: 묶음 제목은 마지막 노트 제목 → 상황 문장 → 제목 없는 연습이다', () => {
  assert.equal(groupTitle(group({ note_title: '시선이 먼저 내려간다', situation: '이별 직후 카페' })), '시선이 먼저 내려간다');
  assert.equal(groupTitle(group({ note_title: null, situation: '이별 직후 카페' })), '이별 직후 카페');
  const fallback = groupTitle(group({ note_title: null, situation: null }));
  assert.equal(typeof fallback, 'string');
  assert.notEqual(fallback, '');
  // 옛 빌드가 빈 칸에 넣던 자리표시자는 제목이 아니다.
  assert.equal(groupTitle(group({ situation: '.' })), fallback);
});

test('practice.library: 숨긴 묶음은 목록에서 빠지고 필터는 전체·즐겨찾기·최근 30일이다', () => {
  const now = Date.parse('2026-09-21T00:00:00Z');
  const groups = [
    group({ root_id: 'a', favorite: true, last_practiced_at: '2026-09-20T02:00:00Z' }),
    group({ root_id: 'b', last_practiced_at: '2026-07-01T02:00:00Z' }),
    group({ root_id: 'c', hidden_at: '2026-09-01T00:00:00Z' }),
  ];

  assert.deepEqual(filterGroups(groups, 'all', now).map((g) => g.root_id), ['a', 'b']);
  assert.deepEqual(filterGroups(groups, 'favorite', now).map((g) => g.root_id), ['a']);
  assert.deepEqual(filterGroups(groups, 'recent30', now).map((g) => g.root_id), ['a']);
  // 숨김 문구는 실제 범위를 말한다 — 영상은 보관함에 남는다.
  assert.match(hideNotice(), /보관함/);
});

test('practice.library: 홈의 최근 연습은 숨기지 않은 묶음 3개다', () => {
  const groups = [
    group({ root_id: 'a', last_practiced_at: '2026-09-18T02:00:00Z' }),
    group({ root_id: 'b', last_practiced_at: '2026-09-20T02:00:00Z' }),
    group({ root_id: 'c', hidden_at: '2026-09-01T00:00:00Z', last_practiced_at: '2026-09-21T02:00:00Z' }),
    group({ root_id: 'd', last_practiced_at: '2026-09-19T02:00:00Z' }),
    group({ root_id: 'e', last_practiced_at: '2026-09-17T02:00:00Z' }),
  ];

  assert.deepEqual(recentGroups(groups).map((g) => g.root_id), ['b', 'd', 'a']);
});

test('practice.library: 연속 연습 일수는 한국 시간으로 세고 자정을 넘긴 회차는 다음 날이다', () => {
  const now = Date.parse('2026-09-21T05:00:00Z'); // 한국 시간 9월 21일 오후 2시
  // 한국 시간 9월 21일 00시 30분 = UTC 9월 20일 15시 30분 — 다음 날로 센다.
  assert.equal(kstDayKey('2026-09-20T15:30:00Z'), '2026-09-21');
  assert.equal(kstDayKey('2026-09-20T14:30:00Z'), '2026-09-20');

  assert.equal(practiceStreak(['2026-09-20T15:30:00Z', '2026-09-19T23:00:00Z'], now), 2);
  // 오늘 아직 안 했어도 어제까지의 연속은 유지한다.
  assert.equal(practiceStreak(['2026-09-19T23:00:00Z'], now), 1);
  assert.equal(practiceStreak([], now), 0);
});

test('practice.library: 리딩 회차는 연습 기록에 시간순으로 섞인다', () => {
  const rows = mergeHistoryRows(
    [{ id: 'p1', at: '2026-09-20T02:00:00Z', kind: 'practice', title: '연습', meta: '' }],
    [{ id: 'r1', at: '2026-09-21T02:00:00Z', kind: 'reading', title: '리딩', meta: '' }],
  );

  assert.deepEqual(rows.map((r) => r.id), ['r1', 'p1']);
  assert.deepEqual(rows.map((r) => r.kind), ['reading', 'practice']);
});

test('practice.library: 회차 줄은 n차·대화 수·노트 제목을 보여 주고 노트가 없으면 그렇게 말한다', () => {
  const withNote = roundSummary({ ordinal: 2, message_count: 6, note: { id: 'n', title: '시선이 먼저 내려간다', kind: 'action' } });
  assert.match(withNote, /2/);
  assert.match(withNote, /6/);
  assert.match(withNote, /시선이 먼저 내려간다/);

  const without = roundSummary({ ordinal: 1, message_count: 2, note: null });
  assert.doesNotMatch(without, /시선/);
  assert.notEqual(without, '');
});
