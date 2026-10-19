import assert from 'node:assert/strict';
import test from 'node:test';

import { inMonth, monthPracticeCounts, profileTabCards } from '../lib/profile-month-stats.ts';

const NOW = new Date(2026, 9, 19, 12, 0, 0); // 2026-10-19 로컬

test('inMonth: 기기 시각 기준 이번 달만 참이다', () => {
  assert.equal(inMonth(new Date(2026, 9, 1, 0, 0, 1).toISOString(), NOW), true);
  assert.equal(inMonth(new Date(2026, 8, 30, 23, 59).toISOString(), NOW), false);
  assert.equal(inMonth(new Date(2025, 9, 10).toISOString(), NOW), false);
  assert.equal(inMonth('엉터리', NOW), false);
  assert.equal(inMonth(null, NOW), false);
});

test('monthPracticeCounts: 코칭·리딩은 회차, 챌린지는 참여한 서로 다른 챌린지를 이번 달 것만 센다', () => {
  const groups = [
    { practices: [{ created_at: new Date(2026, 9, 3).toISOString() }, { created_at: new Date(2026, 8, 3).toISOString() }] },
    { practices: [{ created_at: new Date(2026, 9, 18).toISOString() }] },
  ];
  const sessions = [{ started_at: new Date(2026, 9, 2).toISOString() }, { started_at: new Date(2026, 7, 2).toISOString() }];
  const entries = [
    { created_at: new Date(2026, 9, 5).toISOString(), challenge: { id: 'x' } },
    { created_at: new Date(2026, 9, 6).toISOString(), challenge: { id: 'x' } },
    { created_at: new Date(2026, 8, 6).toISOString(), challenge: { id: 'y' } },
  ];
  assert.deepEqual(monthPracticeCounts({ groups, readingSessions: sessions, entries }, NOW), {
    coaching: 2,
    reading: 1,
    challenge: 1,
    total: 4,
  });
  assert.deepEqual(monthPracticeCounts({ groups: [], readingSessions: [], entries: [] }, NOW), {
    coaching: 0,
    reading: 0,
    challenge: 0,
    total: 0,
  });
});

test('profileTabCards: 연습 기록 카드는 마지막 연습이 최근인 묶음부터, 숨긴 묶음은 뺀다', () => {
  const cards = profileTabCards([
    { root_id: 'a', hidden_at: null, last_practiced_at: '2026-10-01T00:00:00Z', practices: [] },
    { root_id: 'b', hidden_at: '2026-10-02T00:00:00Z', last_practiced_at: '2026-10-10T00:00:00Z', practices: [] },
    { root_id: 'c', hidden_at: null, last_practiced_at: null, practices: [{ created_at: '2026-10-12T00:00:00Z' }] },
  ]);
  assert.deepEqual(cards.map((card) => card.group.root_id), ['c', 'a']);
  assert.equal(cards[0].at, '2026-10-12T00:00:00Z');
});
