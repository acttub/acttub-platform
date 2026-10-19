import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  coachMarkFor,
  COACH_MARKS,
  firstPracticeRange,
  isSplitFailure,
  resumeCandidate,
  resumeSessionOf,
  wrapUpProgress,
} from '../lib/reading/redesign-748.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const card = (id, status) => ({ id, title: id, status, my_character_names: [], dialogue_count: 3, recording_count: 0 });
const session = (id, status, progress) => ({ id, status, progress, ordinal: 1, my_character_names: ['윤서'] });
const d = (role, text = role) => ({ type: 'dialogue', role, text });
const dir = (text = '지문') => ({ type: 'direction', text });

test('내 대본: 이어 읽기 카드는 목록에서 가장 먼저 나오는 「연습 중」 대본이다', () => {
  assert.equal(resumeCandidate([card('a', 'completed'), card('b', 'reading'), card('c', 'reading')])?.id, 'b');
  assert.equal(resumeCandidate([card('a', 'completed'), card('b', 'no_cast')]), null);
  assert.equal(resumeCandidate([]), null);
});

test('내 대본: 이어 읽을 회차는 진행 위치가 있는 진행 중 회차다', () => {
  const s = resumeSessionOf([session('x', 'completed', null), session('y', 'in_progress', { done: 8, total: 15 })]);
  assert.equal(s?.id, 'y');
  assert.equal(resumeSessionOf([session('x', 'in_progress', null)]), null);
  assert.equal(resumeSessionOf([]), null);
});

test('대본 넣기: 못 나눈 경우(읽지 못함·배역 없음·공용 오류)만 실패 화면으로 보인다', () => {
  for (const kind of ['file_unreadable', 'no_characters', 'error']) assert.equal(isSplitFailure({ kind, message: 'x' }), true);
  for (const kind of ['daily_limit', 'file_too_large', 'too_long', 'script_limit', 'busy', 'upload_used', 'consent']) {
    assert.equal(isSplitFailure({ kind }), false);
  }
});

test('연습 구역: 첫 연습은 처음부터 대사 10줄을 짧은 구간으로 고르고, 내 대사 수를 센다', () => {
  const lines = [dir(), ...Array.from({ length: 15 }, (_, i) => d(i % 2 ? '태오' : '윤서', `대사${i + 1}`))];
  const r = firstPracticeRange(lines, ['윤서']);
  assert.deepEqual(r, { startIndex: 1, endIndex: 10, dialogueCount: 10, myCount: 5, lastText: '대사10' });
});

test('연습 구역: 대사가 10줄 이하이거나 짧은 구간에 내 대사가 없으면 추천하지 않는다', () => {
  assert.equal(firstPracticeRange(Array.from({ length: 10 }, () => d('윤서')), ['윤서']), null);
  const lines = [...Array.from({ length: 10 }, () => d('태오')), d('윤서'), d('윤서')];
  assert.equal(firstPracticeRange(lines, ['윤서']), null);
});

test('리딩 마무리: 끝 줄까지의 대사 번호와 다음 시작 번호를 낸다', () => {
  const lines = [d('a'), dir(), d('b'), d('c'), d('d')];
  assert.deepEqual(wrapUpProgress(lines, 2), { readTo: 2, total: 4, next: 3 });
  assert.deepEqual(wrapUpProgress(lines, 4), { readTo: 4, total: 4, next: null });
});

test('첫 리딩 안내: 상대 차례 → 내 차례 → 말한 뒤 다음 → 가린 대사 혼자 읽기 순서로 하나씩 보인다', () => {
  assert.deepEqual(COACH_MARKS, ['partner', 'mine', 'next', 'alone']);
  const none = new Set();
  assert.equal(coachMarkFor({ done: none, status: 'partner', said: false, hiddenMine: false }), 'partner');
  assert.equal(coachMarkFor({ done: new Set(['partner']), status: 'partner', said: false, hiddenMine: false }), null);
  assert.equal(coachMarkFor({ done: new Set(['partner']), status: 'mine', said: false, hiddenMine: false }), 'mine');
  assert.equal(coachMarkFor({ done: new Set(['partner', 'mine']), status: 'mine', said: true, hiddenMine: false }), 'next');
  assert.equal(coachMarkFor({ done: new Set(['partner', 'mine', 'next']), status: 'mine', said: false, hiddenMine: true }), 'alone');
  assert.equal(coachMarkFor({ done: new Set(['partner', 'mine', 'next']), status: 'mine', said: false, hiddenMine: false }), null);
  assert.equal(coachMarkFor({ done: none, status: 'paused', said: false, hiddenMine: false }), null);
});

test('대본 탭: 대본이 없으면 리딩 입구(올리기 줄), 있으면 이어 읽기 카드 — 같이 만들기(서버 없음)는 숨긴다', () => {
  const tab = src('app/(tabs)/reading.tsx');
  assert.match(tab, /t\('reading\.entryUpload'\)/);
  assert.match(tab, /resumeCandidate\(/);
  assert.doesNotMatch(tab, /entryCreate|대본 같이 만들기/);
  assert.match(tab, /ref=\{newTarget\.ref\}/, '스포트라이트 자리는 그대로');
});

test('대본 넣기: 사진 탭과 「다른 거 하고 있을게요」(알림)는 없다', () => {
  const screen = src('app/reading/new.tsx');
  assert.doesNotMatch(screen, /tabPhoto|splitLeave/);
  assert.match(screen, /isSplitFailure\(/);
});

test('리딩 완료: 발음 보고서 PRO 카드는 없고, 완료 뒤 마무리 화면을 거쳐 상세로 간다', () => {
  const play = src('app/reading/play.tsx');
  assert.doesNotMatch(play, /PRO|proReport/);
  assert.match(play, /wrapUpProgress\(/);
  assert.match(play, /t\('reading\.wrapBadge'\)/);
});
