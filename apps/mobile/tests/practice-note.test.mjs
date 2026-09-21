import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUMMARY_QUOTE_MAX,
  noteFallbackNotice,
  noteKindLabel,
  noteSections,
  noteTitle,
  quoteSourceLabel,
} from '../lib/practice/note.ts';

const note = (over = {}) => ({
  id: 'note-1',
  practice_id: 'practice-1',
  format: 'v2',
  kind: 'action',
  title: '말을 끝낸 뒤 시선이 내려가는 곳',
  summary_quotes: [
    { text: '먼저 미안하다고 말해주길 기다렸어요', source: 'actor' },
    { text: '0:41 말을 끝낸 직후 시선이 먼저 내려간다', source: 'observation' },
  ],
  next_take: '대답하기 전에 2초를 더 듣고, 그 뒤에 시선을 든다',
  actor_words: [],
  corrections: [],
  tags: [],
  fallback: false,
  cheer: null,
  source_revision: 7,
  created_at: '2026-09-21T02:00:00Z',
  ...over,
});

test('practice.note: 순서는 요약 → 다음 촬영 → 응원이고 비교 기준이 없다', () => {
  const sections = noteSections(note());

  assert.deepEqual(sections.map((s) => s.kind), ['summary', 'next', 'cheer']);
  assert.equal(sections.some((s) => /비교|이전 연습/.test(s.label)), false);
});

test('practice.note: 제목은 초점 원문이고 요약 인용은 최대 둘·각 인용에 출처가 있다', () => {
  const sections = noteSections(
    note({
      summary_quotes: [
        { text: '하나', source: 'actor' },
        { text: '둘', source: 'observation' },
        { text: '셋', source: 'actor' },
      ],
    }),
  );
  const summary = sections[0];

  assert.equal(noteTitle(note(), '제목 없는 연습'), '말을 끝낸 뒤 시선이 내려가는 곳');
  assert.equal(SUMMARY_QUOTE_MAX, 2);
  assert.equal(summary.quotes.length, 2);
  for (const quote of summary.quotes) {
    assert.ok(['actor', 'observation'].includes(quote.source));
    assert.equal(typeof quoteSourceLabel(quote.source), 'string');
  }
});

test('practice.note: 제안이 있으면 하나만 보여 주고 없으면 없다고 말한다', () => {
  const withProposal = noteSections(note())[1];
  assert.equal(withProposal.hasProposal, true);
  assert.equal(withProposal.text, '대답하기 전에 2초를 더 듣고, 그 뒤에 시선을 든다');

  // 초점만 있는 조기 종료(observation)는 제안이 없다 — 만들어 넣지 않는다.
  const without = noteSections(note({ kind: 'observation', next_take: null }))[1];
  assert.equal(without.hasProposal, false);
  assert.notEqual(without.text, '');
});

test('practice.note: 초점 없이 끝난 노트는 제목이 없어 묶음의 대체 제목을 쓴다', () => {
  const recordOnly = note({ kind: 'record_only', title: null, next_take: null, summary_quotes: [] });

  assert.equal(noteTitle(recordOnly, '이별 직후 카페'), '이별 직후 카페');
  assert.equal(noteTitle(recordOnly, '제목 없는 연습'), '제목 없는 연습');
  // 종류는 성공·실패 표시가 아니라 이름이다.
  assert.equal(typeof noteKindLabel('record_only'), 'string');
  assert.notEqual(noteKindLabel('record_only'), noteKindLabel('action'));
});

test('practice.note: 폴백 노트는 확인된 것만 담았다고 알린다', () => {
  assert.equal(noteFallbackNotice(note()), null);
  assert.equal(typeof noteFallbackNotice(note({ fallback: true })), 'string');
});
