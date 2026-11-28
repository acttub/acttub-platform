import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  coachGroupFor,
  knownSceneTakes,
  lastHandledScript,
  loadSceneTakes,
  markSceneCoached,
  practiceStepOf,
  recordSceneTake,
  resetSceneTakesForTest,
  sceneTakesKey,
} from '../lib/practice/scene-takes.ts';
import {
  clampPrompt,
  directionText,
  loadPromptSize,
  nextPromptSize,
  promptStops,
  promptView,
  savePromptSize,
} from '../lib/practice/scene-prompt.ts';

const memory = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { map: m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
};
const broken = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); } };

beforeEach(() => resetSceneTakesForTest());

const T0 = Date.parse('2026-11-20T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('단계 — 리딩 상태만 있으면 익히는 중·찍을 차례, 배역도 기록도 없으면 없음', () => {
  assert.equal(practiceStepOf({ status: 'reading', last_practiced_at: iso(T0) }, undefined), 'reading');
  assert.equal(practiceStepOf({ status: 'completed', last_practiced_at: iso(T0) }, undefined), 'read');
  assert.equal(practiceStepOf({ status: 'no_cast', last_practiced_at: null }, undefined), null);
});

test('단계 — 리딩 뒤에 찍으면 코칭 받을 차례, 코칭을 시작하면 다시 읽을 차례', () => {
  const script = { status: 'completed', last_practiced_at: iso(T0) };
  assert.equal(practiceStepOf(script, { takenAt: T0 + 1000 }), 'shot');
  assert.equal(practiceStepOf(script, { takenAt: T0 + 1000, coachedAt: T0 + 2000 }), 'coached');
  // 리딩 끝에서 바로 코칭(찍은 기록 없음)
  assert.equal(practiceStepOf(script, { coachedAt: T0 + 2000 }), 'coached');
  // 코칭 뒤에 새로 찍으면 다시 코칭 받을 차례
  assert.equal(practiceStepOf(script, { takenAt: T0 + 3000, coachedAt: T0 + 2000 }), 'shot');
});

test('단계 — 찍은 뒤에 리딩을 다시 하면 리딩 단계가 앞선다', () => {
  const take = { takenAt: T0, coachedAt: T0 + 10 };
  assert.equal(practiceStepOf({ status: 'reading', last_practiced_at: iso(T0 + 5000) }, take), 'reading');
  assert.equal(practiceStepOf({ status: 'completed', last_practiced_at: iso(T0 + 5000) }, take), 'read');
});

test('마지막으로 다룬 대본 — 리딩·촬영·코칭 시각 중 가장 늦은 것, 단계 없는 대본은 빼고', () => {
  const scripts = [
    { id: 'a', status: 'completed', last_practiced_at: iso(T0 + 100) },
    { id: 'b', status: 'reading', last_practiced_at: iso(T0) },
    { id: 'c', status: 'no_cast', last_practiced_at: null },
  ];
  assert.equal(lastHandledScript(scripts, {}).id, 'a');
  assert.equal(lastHandledScript(scripts, { b: { takenAt: T0 + 500 } }).id, 'b');
  assert.equal(lastHandledScript([scripts[2]], {}), null);
  assert.equal(lastHandledScript([], {}), null);
});

test('찍은 장면·코칭 표시를 계정별로 남기고 다시 읽는다', async () => {
  const store = memory();
  await recordSceneTake('u1', 's1', { pendingId: 'p1', uri: 'file://a.mov', durationMs: 4000 }, T0, store);
  assert.deepEqual(knownSceneTakes('u1').s1, { pendingId: 'p1', uri: 'file://a.mov', durationMs: 4000, takenAt: T0 });
  await markSceneCoached('u1', 's1', null, T0 + 1, store);
  assert.equal(knownSceneTakes('u1').s1.coachedAt, T0 + 1);
  assert.equal(knownSceneTakes('u1').s1.pendingId, 'p1');
  // 새로 찍으면 코칭 표시가 지워진다
  await recordSceneTake('u1', 's1', { pendingId: 'p2', uri: null, durationMs: null }, T0 + 2, store);
  assert.equal(knownSceneTakes('u1').s1.coachedAt, undefined);

  resetSceneTakesForTest();
  const again = await loadSceneTakes('u1', store);
  assert.equal(again.s1.pendingId, 'p2');
  assert.deepEqual(await loadSceneTakes('u2', store), {});
  assert.ok(store.map.has(sceneTakesKey('u1')));
  assert.equal(knownSceneTakes(null), null);
  assert.deepEqual(await loadSceneTakes(null, store), {});
  assert.deepEqual(await markSceneCoached(null, 's1'), {});
});

test('저장소를 못 읽거나 못 써도 막지 않고, 모양이 틀린 값은 버린다', async () => {
  assert.deepEqual(await loadSceneTakes('u1', broken), {});
  const all = await recordSceneTake('u1', 's1', { pendingId: 'p', uri: null, durationMs: null }, T0, broken);
  assert.equal(all.s1.takenAt, T0);
  resetSceneTakesForTest();
  assert.deepEqual(await loadSceneTakes('u1', memory({ [sceneTakesKey('u1')]: '[1,2]' })), {});
  resetSceneTakesForTest();
  assert.deepEqual(await loadSceneTakes('u1', memory({ [sceneTakesKey('u1')]: '{oops' })), {});
});

test('코치 메모 묶음 — 묶음 id 를 알면 그것, 모르면 코칭 시작 뒤 같은 제목의 가장 최근 묶음', () => {
  const groups = [
    { root_id: 'g1', title: '햄릿', last_practiced_at: iso(T0 + 1000) },
    { root_id: 'g2', title: '햄릿', last_practiced_at: iso(T0 + 5000) },
    { root_id: 'g3', title: '맥베스', last_practiced_at: iso(T0 + 9000) },
    { root_id: 'g0', title: '햄릿', last_practiced_at: iso(T0 - 600_000) },
  ];
  const titleOf = (g) => g.title;
  assert.equal(coachGroupFor({ coachedAt: T0 }, '햄릿', groups, titleOf).root_id, 'g2');
  assert.equal(coachGroupFor({ coachedAt: T0, coachRootId: 'g1' }, '햄릿', groups, titleOf).root_id, 'g1');
  assert.equal(coachGroupFor({ coachedAt: T0, coachRootId: 'zz' }, '햄릿', groups, titleOf), null);
  assert.equal(coachGroupFor({ takenAt: T0 }, '햄릿', groups, titleOf), null);
  assert.equal(coachGroupFor(undefined, '햄릿', groups, titleOf), null);
  assert.equal(coachGroupFor({ coachedAt: T0 }, '오셀로', groups, titleOf), null);
});

const line = (kind, speaker, text, mine = false) => ({ kind, speaker, text, mine });
const LINES = [
  line('scene', null, '1장'),
  line('dialogue', '오필리아', '왕자님'),
  line('dialogue', '햄릿', '사느냐', true),
  line('direction', null, '고개를 든다'),
  line('dialogue', '오필리아', '네?'),
  line('scene', null, '2장'),
  line('dialogue', '햄릿', '죽느냐', true),
];

test('프롬프터 — 내 대사만 넘기고 앞·뒤는 장면 머리를 건너뛴 가까운 줄', () => {
  assert.deepEqual(promptStops(LINES), [2, 6]);
  const first = promptView(LINES, 0);
  assert.equal(first.current.text, '사느냐');
  assert.equal(first.prev.text, '왕자님');
  assert.equal(first.next.text, '고개를 든다');
  assert.deepEqual([first.no, first.total], [1, 2]);
  const last = promptView(LINES, 9);
  assert.equal(last.current.text, '죽느냐');
  assert.equal(last.prev.text, '네?');
  assert.equal(last.next, null);
  assert.equal(promptView(LINES, -3).no, 1);
});

test('프롬프터 — 내 대사가 없으면 대사 전부, 대사가 없으면 빈 화면', () => {
  const noMine = LINES.map((l) => ({ ...l, mine: false }));
  assert.deepEqual(promptStops(noMine), [1, 2, 4, 6]);
  assert.equal(promptView(noMine, 0).prev, null);
  assert.deepEqual(promptView([line('scene', null, '1장')], 0), { prev: null, current: null, next: null, no: 0, total: 0 });
  assert.equal(clampPrompt(5, 3), 2);
  assert.equal(directionText('웃는다'), '(웃는다)');
  assert.equal(directionText('(웃는다)'), '(웃는다)');
});

test('프롬프터 글자 크기 — 작게·보통·크게를 돌고 기기에 기억한다', async () => {
  assert.equal(nextPromptSize('small'), 'normal');
  assert.equal(nextPromptSize('normal'), 'large');
  assert.equal(nextPromptSize('large'), 'small');
  const store = memory();
  assert.equal(await loadPromptSize(store), 'normal');
  await savePromptSize('large', store);
  assert.equal(await loadPromptSize(store), 'large');
  assert.equal(await loadPromptSize(memory({ 'acttub.promptSize': 'huge' })), 'normal');
  assert.equal(await loadPromptSize(broken), 'normal');
  await savePromptSize('small', broken);
});
