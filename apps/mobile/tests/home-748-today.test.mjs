import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { challengeDaysLeft, isFirstUser, pickToday, tipIndex } from '../lib/home-today.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const round = (id, at, note = null) => ({
  id,
  ordinal: 1,
  created_at: at,
  stage: 'done',
  message_count: 4,
  note,
  conversation_id: null,
  previous_conversations: [],
});
const group = (rootId, at, extra = {}) => ({
  root_id: rootId,
  title: null,
  ordinal_count: 1,
  in_progress_practice_id: null,
  favorite: false,
  hidden_at: null,
  last_practiced_at: at,
  practices: [round(`${rootId}-1`, at, { id: 'n', title: '한 박자 바라보기', kind: 'action' })],
  ...extra,
});
const script = (id, lastPracticed, status = 'reading') => ({
  id,
  title: `대본 ${id}`,
  my_character_names: [],
  dialogue_count: 10,
  recording_count: 0,
  last_practiced_at: lastPracticed,
  last_activity_at: lastPracticed ?? '2026-10-01T00:00:00Z',
  status,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});
const challenge = (endsAt) => ({ id: 'c1', line: '나는 갈매기', work: '갈매기', ends_at: endsAt });
const NOW = new Date('2026-10-19T03:00:00Z'); // 한국 10/19 정오

test('첫 사용자: 연습 1회(코칭 노트·리딩 완료·챌린지 참여)를 끝내기 전까지(SOMA-827)', () => {
  assert.equal(isFirstUser({ groups: [], scripts: [], practicedDays: 0 }), true);
  // 시작만 하고 나간 사람은 아직 첫 사용자다 — 대본만 넣었거나(예시 포함) 코칭을 노트 전에 나간 경우.
  assert.equal(isFirstUser({ groups: [], scripts: [script('s', null, 'no_cast')], practicedDays: 0 }), true);
  assert.equal(isFirstUser({ groups: [], scripts: [script('s', '2026-10-10T00:00:00Z')], practicedDays: 0 }), true);
  const noNote = group('a', '2026-10-10T00:00:00Z', { practices: [round('a-1', '2026-10-10T00:00:00Z')] });
  assert.equal(isFirstUser({ groups: [noNote], scripts: [], practicedDays: 0 }), true);
  // 끝낸 연습이 하나라도 있으면 아니다 — 노트가 생긴 코칭(숨긴 묶음 포함), 끝까지 읽은 대본, 연습한 날.
  assert.equal(isFirstUser({ groups: [group('a', '2026-10-10T00:00:00Z')], scripts: [], practicedDays: 0 }), false);
  assert.equal(isFirstUser({ groups: [group('a', '2026-10-10T00:00:00Z', { hidden_at: '2026-10-11T00:00:00Z' })], scripts: [], practicedDays: 0 }), false);
  assert.equal(isFirstUser({ groups: [], scripts: [script('s', '2026-09-01T00:00:00Z', 'completed')], practicedDays: 0 }), false);
  assert.equal(isFirstUser({ groups: [], scripts: [], practicedDays: 2 }), false);
});

test('오늘 할 것: 가장 최근에 하다 만 것 하나, 나머지 하나는 「하던 거」 줄', () => {
  const coaching = group('g', '2026-10-18T00:00:00Z');
  const reading = script('s', '2026-10-17T00:00:00Z');
  const pick = pickToday({ groups: [coaching], scripts: [reading], challenge: null, now: NOW });
  assert.equal(pick.main.kind, 'coaching');
  // 노트 제목(코치 관찰)은 싣지 않고, 다음 테이크 문장을 불러올 회차만 알려 준다.
  assert.equal(pick.main.notePracticeId, 'g-1');
  assert.equal('noteTitle' in pick.main, false);
  assert.equal(pick.also?.kind, 'reading');

  const newerReading = script('s2', '2026-10-18T12:00:00Z');
  const flipped = pickToday({ groups: [coaching], scripts: [reading, newerReading], challenge: null, now: NOW });
  assert.equal(flipped.main.kind, 'reading');
  assert.equal(flipped.main.script.id, 's2');
  assert.equal(flipped.also?.kind, 'coaching');
});

test('오늘 할 것: 같은 시각이면 코칭 숙제 > 리딩', () => {
  const at = '2026-10-18T00:00:00Z';
  const pick = pickToday({ groups: [group('g', at)], scripts: [script('s', at)], challenge: null, now: NOW });
  assert.equal(pick.main.kind, 'coaching');
});

test('오늘 할 것: 다 읽은 대본·숨긴 묶음은 후보가 아니다', () => {
  const pick = pickToday({
    groups: [group('g', '2026-10-18T00:00:00Z', { hidden_at: '2026-10-18T01:00:00Z' })],
    scripts: [script('s', '2026-10-18T00:00:00Z', 'completed')],
    challenge: null,
    now: NOW,
  });
  assert.equal(pick.main.kind, 'start');
  assert.equal(pick.also, null);
});

test('오늘 할 것: 만들어 두고 아직 안 읽은 대본도 리딩 카드로 고른다', () => {
  const fresh = { ...script('s', null, 'no_cast'), last_activity_at: '2026-10-18T00:00:00Z' };
  const pick = pickToday({ groups: [], scripts: [fresh], challenge: null, now: NOW });
  assert.equal(pick.main.kind, 'reading');
  assert.equal(pick.main.script.id, 's');
});

test('오늘 할 것: 노트 없이 나간 코칭 묶음은 숙제 후보가 아니다', () => {
  const left = group('g', '2026-10-18T00:00:00Z', { practices: [round('g-1', '2026-10-18T00:00:00Z', null)] });
  const pick = pickToday({ groups: [left], scripts: [], challenge: null, now: NOW });
  assert.equal(pick.main.kind, 'start');
});

test('오늘 할 것: 코칭·리딩이 없으면 진행 중인 오늘의 챌린지, 그것도 없으면 연습 시작', () => {
  const live = pickToday({ groups: [], scripts: [], challenge: challenge('2026-10-20T14:59:00Z'), now: NOW });
  assert.equal(live.main.kind, 'challenge');
  assert.equal(live.main.daysLeft, 1);
  const ended = pickToday({ groups: [], scripts: [], challenge: challenge('2026-10-18T00:00:00Z'), now: NOW });
  assert.equal(ended.main.kind, 'start');
});

test('챌린지 마감 D-day는 한국 날짜로 센다', () => {
  assert.equal(challengeDaysLeft('2026-10-19T14:59:00Z', NOW), 0); // 한국 10/19 23:59
  assert.equal(challengeDaysLeft('2026-10-19T15:00:00Z', NOW), 1); // 한국 10/20 00:00
  assert.equal(challengeDaysLeft('nope', NOW), null);
});

test('오늘의 연기 팁은 하루 동안 같고 팁 수 안에서 돈다', () => {
  const a = tipIndex(new Date('2026-10-19T01:00:00Z'), 7);
  const b = tipIndex(new Date('2026-10-19T10:00:00Z'), 7);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 7);
  assert.notEqual(tipIndex(new Date('2026-10-20T01:00:00Z'), 7), a);
});

test('홈 화면: 첫 사용자 질문 3개·오늘 할 것 카드·알림 종을 그리고 일정 D-day는 없다', () => {
  const home = src('app/(tabs)/index.tsx');
  // 첫 사용자 판단은 lib/practice/first-time(안에서 isFirstUser)이 탭바 숨김과 함께 한 번 한다.
  assert.match(home, /firstTimeStateFrom\(/);
  assert.match(home, /pickToday\(/);
  assert.match(home, /t\('home\.firstQuestion'\)/);
  assert.match(home, /router\.push\('\/notifications'\)/);
  // 오늘 할 것 카드가 첫 가이드가 비추는 자리다.
  // 카드 전체가 누르는 곳이라 첫 가이드 자리(ref)를 카드에 넘긴다(10/28).
  assert.match(home, /cardRef=\{startTarget\.ref\}/);
});

test('primaryFeature: 최근 2주에 센 연습이 가장 많은 기능, 같으면 더 최근, 없으면 null', async () => {
  const { primaryFeature } = await import('../lib/home-today.ts');
  const day = 24 * 60 * 60 * 1000;
  const at = (n) => new Date(NOW.getTime() - n * day).toISOString();
  assert.equal(primaryFeature([], NOW), null);
  assert.equal(
    primaryFeature([{ kind: 'coaching', at: at(1) }, { kind: 'reading', at: at(2) }, { kind: 'reading', at: at(3) }], NOW),
    'reading',
  );
  assert.equal(primaryFeature([{ kind: 'coaching', at: at(1) }, { kind: 'challenge', at: at(2) }], NOW), 'coaching');
  // 2주보다 오래된 연습은 세지 않는다.
  assert.equal(primaryFeature([{ kind: 'challenge', at: at(20) }, { kind: 'coaching', at: at(3) }], NOW), 'coaching');
});

test('pickToday: 주 기능이 챌린지면 열린 챌린지가 메인, 리딩이면 코칭보다 먼저 고른다', () => {
  const at = '2026-08-20T00:00:00Z';
  const challenge = { id: 'c1', line: '대사', work: '작품', ends_at: new Date(NOW.getTime() + 2 * 86400000).toISOString() };
  const withChallenge = pickToday({ groups: [group('g', at)], scripts: [], challenge, now: NOW, primary: 'challenge' });
  assert.equal(withChallenge.main.kind, 'challenge');
  assert.equal(withChallenge.also.kind, 'coaching');
  const reading = pickToday({ groups: [group('g', '2026-08-25T00:00:00Z')], scripts: [script('s', at)], challenge: null, now: NOW, primary: 'reading' });
  assert.equal(reading.main.kind, 'reading');
  assert.equal(reading.also.kind, 'coaching');
});
