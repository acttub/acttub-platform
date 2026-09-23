import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cardMeta,
  lastActivityLabel,
  listHeader,
  myCharactersLabel,
  statusChip,
} from '../lib/reading/script-cards.ts';

const NOW = Date.parse('2026-09-21T12:00:00+09:00');

function card(overrides = {}) {
  return {
    id: 'sc_1',
    title: '갈매기',
    my_character_names: ['니나'],
    dialogue_count: 42,
    recording_count: 3,
    last_activity_at: '2026-09-20T21:00:00+09:00',
    status: 'reading',
    updated_at: '2026-09-20T21:00:00+09:00',
    ...overrides,
  };
}

test('reading.script: 목록 머리는 "전체 N개 · 연습 중 M개"다', () => {
  assert.equal(listHeader({ total_count: 12, in_progress_count: 3 }), '전체 12개 · 연습 중 3개');
  assert.equal(listHeader({ total_count: 0, in_progress_count: 0 }), '전체 0개 · 연습 중 0개');
});

test('reading.script: 상태 칩은 셋뿐이다 — 열린 회차 "연습 중", 마지막 회차 완료 "연습 완료", 그 밖 "배역 선택"', () => {
  assert.equal(statusChip(card({ status: 'reading' })).label, '연습 중');
  assert.equal(statusChip(card({ status: 'completed' })).label, '연습 완료');
  assert.equal(statusChip(card({ status: 'no_cast' })).label, '배역 선택');
  for (const status of ['reading', 'completed', 'no_cast']) {
    assert.notEqual(statusChip(card({ status })).label, '분석 완료', '리딩에는 분석이 없다');
  }
});

test('reading.script: 카드의 내 배역은 마지막 회차의 배역이고 회차가 없으면 "배역 미선택"이다', () => {
  assert.equal(myCharactersLabel(card({ my_character_names: ['니나', '트레플레프'] })), '니나, 트레플레프');
  assert.equal(myCharactersLabel(card({ my_character_names: [] })), '배역 미선택');
});

test('reading.script: 카드는 대사 수와 녹음 수(모든 회차 합)를 보여 준다', () => {
  assert.equal(cardMeta(card({ dialogue_count: 42, recording_count: 3 })), '대사 42개 · 녹음 3개');
});

test('reading.script: 마지막 활동 날짜 — "어제 연습", "5월 25일 업로드"', () => {
  assert.equal(lastActivityLabel(card({ last_activity_at: '2026-09-20T21:00:00+09:00' }), NOW), '어제 연습');
  assert.equal(lastActivityLabel(card({ last_activity_at: '2026-09-21T09:00:00+09:00' }), NOW), '오늘 연습');
  assert.equal(
    lastActivityLabel(card({ my_character_names: [], status: 'no_cast', last_activity_at: '2026-05-25T09:00:00+09:00' }), NOW),
    '5월 25일 업로드',
  );
  assert.equal(lastActivityLabel(card({ last_activity_at: null }), NOW), '');
  // 서버 계약(RA1): last_practiced_at 이 있으면 연습, null 이면 업로드
  assert.equal(
    lastActivityLabel(card({ my_character_names: [], last_practiced_at: '2026-09-20T21:00:00+09:00', last_activity_at: '2026-09-20T21:00:00+09:00' }), NOW),
    '어제 연습',
  );
  assert.equal(
    lastActivityLabel(card({ my_character_names: ['니나'], last_practiced_at: null, last_activity_at: '2026-05-25T09:00:00+09:00' }), NOW),
    '5월 25일 업로드',
  );
});
