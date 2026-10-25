import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUMMARY_QUOTE_MAX,
  noteFallbackNotice,
  noteKindLabel,
  noteNextTake,
  noteSections,
  noteTitle,
  quoteSourceLabel,
} from '../lib/practice/note.ts';

const note = (over = {}) => ({
  id: 'note-1',
  conversation_id: 'conversation-1',
  format: 'v2',
  kind: 'action',
  title: '말을 끝낸 뒤 시선이 내려가는 곳',
  summary_quotes: [
    { quote: '먼저 미안하다고 말해주길 기다렸어요', kind: 'actor', source_ref: 'actor:1' },
    { quote: '0:41 말을 끝낸 직후 시선이 먼저 내려간다', kind: 'observation', source_ref: 'observation:1' },
  ],
  next_take: '대답하기 전에 2초를 더 듣고, 그 뒤에 시선을 든다',
  actor_words: [],
  corrections: [],
  tags: [],
  fallback: false,
  report: null,
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
        { quote: '하나', kind: 'actor', source_ref: 'actor:1' },
        { quote: '둘', kind: 'observation', source_ref: 'observation:1' },
        { quote: '셋', kind: 'actor', source_ref: 'actor:1' },
      ],
    }),
  );
  const summary = sections[0];

  assert.equal(noteTitle(note(), '제목 없는 연습'), '말을 끝낸 뒤 시선이 내려가는 곳');
  assert.equal(SUMMARY_QUOTE_MAX, 2);
  // 「이번에 해 본 것」에는 배우가 한 말만 — 코치 관찰(observation)은 넣지 않는다(SOMA-771).
  assert.deepEqual(summary.quotes.map((q) => q.quote), ['하나', '셋']);
  for (const quote of summary.quotes) {
    assert.equal(quote.kind, 'actor');
    assert.equal(typeof quoteSourceLabel(quote.kind), 'string');
  }
});

test('practice.note: 「이번에 해 본 것」은 관찰 인용만 있으면 인용 없이 요약 문장(없으면 짧게 나눴다는 말)을 쓴다', () => {
  const onlyObservation = [{ quote: '시선이 먼저 내려간다', kind: 'observation', source_ref: 'observation:1' }];
  const plain = noteSections(note({ summary_quotes: onlyObservation }))[0];
  assert.deepEqual(plain.quotes, []);
  assert.equal(plain.text, '이번에는 짧게 나눴어요.');

  // 코치 관찰과 같은 요약 문장(노트 제목)은 「이번에 해 본 것」으로 다시 쓰지 않는다.
  const report = { report_type: 'practice_note', summary: '말을 끝낸 뒤 시선이 내려가는 곳', practice: null };
  assert.equal(noteSections(note({ summary_quotes: onlyObservation, report }))[0].text, '이번에는 짧게 나눴어요.');
  const own = { ...report, summary: '「우리 그만하자」 뒤에 2초 멈춰 봤어요.' };
  assert.equal(noteSections(note({ summary_quotes: onlyObservation, report: own }))[0].text, '「우리 그만하자」 뒤에 2초 멈춰 봤어요.');
});

test('practice.note: 다음 테이크 문장 — 노트 제목(액티 관찰)이 아니라 「다음에 해 볼 것」, 없으면 null', () => {
  assert.equal(noteNextTake(note()), '대답하기 전에 2초를 더 듣고, 그 뒤에 시선을 든다');
  assert.equal(noteNextTake(note({ next_take: '  ' })), null);
  assert.equal(noteNextTake(note({ report: { report_type: 'practice_note', summary: null, practice: { instruction: ' 한 박자 쉬기 ' } } })), '한 박자 쉬기');
  assert.equal(noteNextTake(note({ report: { report_type: 'practice_note', summary: null, practice: null } })), null);
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
