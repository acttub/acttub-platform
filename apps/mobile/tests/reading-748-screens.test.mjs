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
  // 「새 대본」은 고르기 창 없이 바로 내 대본 올리기로 간다(10/25).
  assert.match(tab, /onPress=\{\(\) => router\.push\('\/reading\/new'\)\}/);
  assert.match(tab, /resumeCandidate\(/);
  assert.doesNotMatch(tab, /entryCreate|대본 같이 만들기/);
  assert.match(tab, /ref=\{newTarget\.ref\}/, '스포트라이트 자리는 그대로');
});

test('대본 넣기: 파일·글 붙여넣기·대본 같이 만들기 셋 중 고르고, 예시 대본 링크는 없다(10/25)', () => {
  const screen = src('app/reading/new.tsx');
  assert.match(screen, /t\('reading\.entryCocreate'\)/);
  // 화면을 넘기지 않고 아래에 「예시 대본 고르기 · 새 대본 만들기」를 펼친다. 새 대본 만들기만 대본 만들기로 간다.
  assert.match(screen, /<SamplePickerBody /);
  assert.match(screen, /pathname: '\/script-cocreate', params: \{ mode: 'reading', start: 'make' \}/);
  assert.doesNotMatch(screen, /sampleLink|showsSampleLink/);
});

test('대본 넣기: 사진 탭과 「다른 거 하고 있을게요」(알림)는 없다', () => {
  const screen = src('app/reading/new.tsx');
  assert.doesNotMatch(screen, /tabPhoto/);
  assert.doesNotMatch(src('locales/ko.ts'), /다른 거 하고 있을게요/);
  assert.match(screen, /isSplitFailure\(/);
});

test('리딩 완료: 녹음 액티·발음 보고서는 별도 카드(서버 스위치를 켠 배포만)로만 붙고, 완료 화면의 「홈으로 가기」는 홈 탭으로 간다(pen R9.42)', () => {
  const play = src('app/reading/play.tsx');
  // 발음 보고서 PRO 줄은 완료 화면에 직접 그리지 않는다 — 서버가 허용할 때만 ReadingAfterCard 가 그린다(10/22).
  assert.doesNotMatch(play, /PRO|proReport/);
  assert.match(play, /<ReadingAfterCard sessionId=\{session\.id\} ready=\{pendingUploads === 0\} part="coach" \/>/);
  assert.match(play, /part="report"/);
  assert.match(play, /router\.dismissTo\('\/\(tabs\)'\)/);
});

test('첫 리딩 안내는 기기에 한 번 본 것으로 남고, 못 읽으면 본 것으로 친다', async () => {
  const { hasSeenFirstReadingGuide, markFirstReadingGuideSeen } = await import('../lib/reading/guide-flag.ts');
  const map = new Map();
  const store = { getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => void map.set(k, v) };
  assert.equal(await hasSeenFirstReadingGuide(store), false);
  await markFirstReadingGuideSeen(store);
  assert.equal(await hasSeenFirstReadingGuide(store), true);
  assert.equal(await hasSeenFirstReadingGuide({ getItem: async () => { throw new Error('x'); }, setItem: async () => {} }), true);
});

test('리딩 실행: 시작 전 안내는 팝업 대신 아래 [시작]이고, 첫 리딩 안내는 진행 상태로만 띄운다', () => {
  const play = src('app/reading/play.tsx');
  assert.match(play, /t\(monologue \? 'reading\.monologueStartHint' : 'reading\.startHint'\)/);
  assert.match(play, /onPress=\{\(\) => void closeTip\(\)\}/);
  // 「시작하고 이 안내는 다음부터 숨기기」는 없다 — [시작]이 곧 다음부터 숨기기다(10/29).
  assert.doesNotMatch(play, /startSkipNext/);
  assert.doesNotMatch(play, /visible=\{hold === 'tip'\}/);
  // 첫 리딩 안내는 화면을 덮는 버튼 설명이 아니라, 지금 차례에 맞는 말풍선을 하나씩 띄운다(10/29 되살림).
  assert.doesNotMatch(play, /ReadingGuideOverlay/);
  assert.match(play, /coachMarkFor\(\{ done: coachDone/);
  assert.match(play, /<ReadingCoachMark/);
});

test('리딩 → 코칭: 대본 제목·장면을 상황 칸에, 내 배역을 인물 칸에 채우고 원하는 것은 비운다(SOMA-772)', async () => {
  const { readingCoachScene } = await import('../lib/reading/redesign-748.ts');
  const lines = [{ type: 'scene', text: '1장 카페' }, d('민재', '왔구나.'), d('서연'), { type: 'scene', text: '2장' }, d('민재')];
  const lineIds = ['l1', 'l2', 'l3', 'l4', 'l5'];
  const scenes = [
    { no: 1, title: '1장 카페', start_line_id: 'l1', end_line_id: 'l3' },
    { no: 2, title: null, start_line_id: 'l4', end_line_id: 'l5' },
  ];
  const t = (key, p) => (key === 'reading.rangeScene' ? `장면 ${p.n}` : key);
  const base = { title: '봄날의 대화', lines, lineIds, scenes, myRoles: ['민재', '서연'], t };

  assert.deepEqual(readingCoachScene({ ...base, startIndex: 1 }), { situation: '봄날의 대화 · 1장 카페', character: '민재, 서연', goal: '' });
  assert.equal(readingCoachScene({ ...base, startIndex: 4 }).situation, '봄날의 대화 · 장면 2');
  assert.equal(readingCoachScene({ ...base, scenes: [], startIndex: 1 }).situation, '봄날의 대화');
  assert.equal(readingCoachScene({ ...base, title: 'x'.repeat(400), startIndex: 1 }).situation.length, 300);
});

test('리딩 3번: 첫 연습 구간의 내 대사는 내 배역이 든 함께 말하는 줄까지 센다(turnRoles 를 넘긴다)', () => {
  const lines = [...Array.from({ length: 9 }, () => d('태오')), d('윤서, 태오'), d('윤서'), d('윤서')];
  assert.equal(firstPracticeRange(lines, ['윤서']), null, '이름 줄만 보면 내 대사가 없다');
  assert.deepEqual(firstPracticeRange(lines, ['윤서', '윤서, 태오'])?.myCount, 1);
  // 구간 고르기는 더 이상 처음 10줄을 추천하지 않는다 — 리딩 화면이 10줄씩 끊어 보인다(SOMA-934).
  assert.doesNotMatch(src('app/reading/range.tsx'), /firstPracticeRange\(/);
  assert.match(src('app/reading/range.tsx'), /fewLines\(lines, myTurnRoles,/);
  assert.match(src('app/reading/range.tsx'), /roleLineCount\(c, lines, script\.characters\)/);
});
