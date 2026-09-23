import assert from 'node:assert/strict';
import test from 'node:test';

import { NetworkError } from '../lib/api-request.ts';
import {
  MEMO_MODES,
  maskTokens,
  memorizationHeading,
  memorizationProgress,
  memorizationTargets,
  recite,
  renderMasked,
} from '../lib/reading/memorization.ts';
import { MEMORIZATION_QUEUE_KEY, createMemorizationSync } from '../lib/reading/memorization-sync.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
// 니나 대사 10줄, 상대(트레플레프) 대사가 사이사이
const LINES = [];
for (let i = 1; i <= 10; i++) {
  LINES.push(D('트레플레프', `상대 ${i}`));
  LINES.push(D('니나', `니나 대사 ${i}`));
}
LINES.push(X('암전'));
const IDS = LINES.map((_, i) => `l${i}`);
const script = { lines: LINES, lineIds: IDS };
const entry = (lineId, status) => ({ line_id: lineId, status, updated_at: '2026-09-21T00:00:00Z' });
const ninaIds = IDS.filter((_, i) => LINES[i].type === 'dialogue' && LINES[i].role === '니나');

test('reading.memorization: 내 대사 10줄 중 3줄이 memorized 면 머리가 "암기하지 못한 대사 7개"이고 목록에 7줄(행 없는 줄 포함)이 있다', () => {
  const entries = [entry(ninaIds[0], 'memorized'), entry(ninaIds[3], 'memorized'), entry(ninaIds[7], 'memorized'), entry(ninaIds[1], 'not_yet')];
  const targets = memorizationTargets(script, ['니나'], entries);
  assert.equal(targets.lines.length, 7);
  assert.equal(targets.total, 10);
  assert.equal(targets.memorizedCount, 3);
  assert.equal(memorizationHeading(['니나'], targets.lines.length), '니나 역 · 암기하지 못한 대사 7개');
  assert.equal(memorizationProgress(targets), '외운 줄 3 / 내 대사 10');
  assert.ok(targets.lines.every((l) => l.role === '니나' && !l.memorized));
  assert.deepEqual(targets.lines[0].previousPartner, { role: '트레플레프', text: '상대 2' }, '바로 전 상대 대사를 함께 보여 준다');
});

test('reading.memorization: 10줄 모두 memorized 면 대상이 없다("못 외운 대사가 없어요")', () => {
  const targets = memorizationTargets(script, ['니나'], ninaIds.map((id) => entry(id, 'memorized')));
  assert.equal(targets.lines.length, 0);
  assert.equal(targets.memorizedCount, 10);
});

test('reading.memorization: R05 의 다시 볼 대사로 들어오면 그 줄들이 대상이고 memorized 였던 줄도 보이며 표시는 바뀌지 않는다', () => {
  const entries = [entry(ninaIds[2], 'memorized')];
  const targets = memorizationTargets(script, ['니나'], entries, { onlyLineIds: [ninaIds[2], ninaIds[5]] });
  assert.deepEqual(targets.lines.map((l) => l.lineId), [ninaIds[2], ninaIds[5]]);
  assert.equal(targets.lines[0].memorized, true, 'memorized 인 채로 열린다');
});

test('reading.memorization: "외운 대사도 보기"면 memorized 줄도 보여 not_yet 으로 되돌릴 수 있다', () => {
  const entries = [entry(ninaIds[0], 'memorized')];
  const targets = memorizationTargets(script, ['니나'], entries, { includeMemorized: true });
  assert.equal(targets.lines.length, 10);
  assert.equal(targets.lines[0].memorized, true);
});

test('reading.memorization: 모드는 넷이다 — 가리고·빈칸·첫 글자·듣고 따라 하기', () => {
  assert.deepEqual(MEMO_MODES.map((m) => m.value), ['hidden', 'blanks', 'initials', 'listen']);
});

test('reading.memorization: 빈칸 연습은 둘째·넷째… 어절을 가리고 같은 대사를 두 번 열면 같은 어절이 가려진다', () => {
  const text = '너 힘들면 항상 높은 데로 가잖아';
  const a = maskTokens(text, 'blanks');
  const b = maskTokens(text, 'blanks');
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((t) => t.masked), [false, true, false, true, false, true]);
  assert.equal(renderMasked(text, 'blanks'), '너 ___ 항상 __ 데로 ___');
});

test('reading.memorization: 첫 글자 모드는 가린 어절의 첫 글자를 남기고, 가리고 연습은 본문을 다 가리며 힌트로 첫 글자를 보여 준다', () => {
  assert.equal(renderMasked('너 힘들면 항상 높은', 'initials'), '너 힘__ 항상 높_');
  assert.equal(renderMasked('너 힘들면', 'hidden'), '_ ___');
  assert.equal(renderMasked('너 힘들면', 'hidden', { hint: true }), '너 힘__');
  assert.equal(renderMasked('너 힘들면', 'listen'), '_ ___', '듣고 따라 하기는 재생하는 동안 본문을 가린다');
});

test('reading.memorization: 괄호 지문이 있는 대사는 지문을 가리지 않고 대조에도 넣지 않는다', () => {
  const tokens = maskTokens('(웃으며) 그런가 정말', 'hidden');
  assert.deepEqual(tokens[0], { kind: 'direction', text: '(웃으며)', masked: false, shown: '(웃으며)' });
  assert.equal(recite('그런가 정말', '(웃으며) 그런가 정말', 0).kind, 'pass');
});

test('reading.memorization: "외워서 말해보기" — 유사도 0.72 는 통과(넘어가기), 0.71 은 미달(다시·원문 보기), 같은 줄 2회 미달이면 안내 없이 다음 줄', () => {
  const target = '여기 있을 줄 알았어';
  assert.deepEqual(recite('여기 있을 줄 알았어', target, 0), { kind: 'pass' });
  const first = recite('완전히 다른 말이야 정말로', target, 0);
  assert.deepEqual(first, { kind: 'retry', misses: 1 });
  assert.deepEqual(recite('완전히 다른 말이야 정말로', target, 1), { kind: 'advance', misses: 2 });
});

test('reading.memorization: 인식 불가·무발화·1,000자 초과는 미달로 세지 않는다', () => {
  assert.deepEqual(recite('', '여기', 0), { kind: 'nothing' });
  assert.deepEqual(recite('…', '여기', 1), { kind: 'nothing' });
  assert.deepEqual(recite('가'.repeat(1001), '여기', 0), { kind: 'nothing' });
});

// ── 저장 큐 ────────────────────────────────────────────────────────────────

function phone({ offline = false } = {}) {
  const items = new Map();
  const server = { rows: new Map(), puts: [] };
  const state = { offline };
  const storage = {
    getItem: async (k) => items.get(k) ?? null,
    setItem: async (k, v) => void items.set(k, v),
    removeItem: async (k) => void items.delete(k),
  };
  const send = async (lineId, status) => {
    server.puts.push([lineId, status]);
    if (state.offline) throw new NetworkError();
    const prev = server.rows.get(lineId);
    const row = prev && prev.status === status ? prev : { line_id: lineId, status, updated_at: `t${server.puts.length}` };
    server.rows.set(lineId, row);
    return row;
  };
  return { items, server, state, storage, send };
}

test('reading.memorization: 줄 하나를 "이 대사 외웠어요"로 하면 PUT memorized, "아직 헷갈려요"는 not_yet, 같은 상태를 다시 눌러도 보내지 않는다', async () => {
  const p = phone();
  const sync = createMemorizationSync({ storage: p.storage, send: p.send, initial: [] });
  await sync.set('l1', 'memorized');
  await sync.set('l1', 'memorized');
  await sync.set('l1', 'not_yet');
  assert.deepEqual(p.server.puts, [['l1', 'memorized'], ['l1', 'not_yet']]);
  assert.equal(sync.status('l1'), 'not_yet');
  assert.equal(sync.pending(), 0);
});

test('reading.memorization: 오프라인에서 토글하면 기기 값을 먼저 보여 주고, 연결되면 다시 보내 서버 값이 기기 값과 같다', async () => {
  const p = phone({ offline: true });
  const sync = createMemorizationSync({ storage: p.storage, send: p.send, initial: [] });
  await sync.set('l1', 'memorized');
  assert.equal(sync.status('l1'), 'memorized', '기기 값 먼저');
  assert.equal(sync.pending(), 1);
  assert.ok(p.items.get(MEMORIZATION_QUEUE_KEY)?.includes('l1'), '보내지 못한 것은 저장소에 남는다');
  p.state.offline = false;
  await sync.flush();
  assert.equal(p.server.rows.get('l1').status, 'memorized');
  assert.equal(sync.pending(), 0);
  assert.equal(p.items.has(MEMORIZATION_QUEUE_KEY), false);
});

test('reading.memorization: 앱을 다시 열어도(새 인스턴스) 보내지 못한 토글이 남아 다시 보낸다', async () => {
  const p = phone({ offline: true });
  await createMemorizationSync({ storage: p.storage, send: p.send, initial: [] }).set('l2', 'not_yet');
  p.state.offline = false;
  const restarted = createMemorizationSync({ storage: p.storage, send: p.send, initial: [] });
  await restarted.restore();
  assert.equal(restarted.status('l2'), 'not_yet', '서버 값보다 기기 값이 먼저다');
  await restarted.flush();
  assert.equal(p.server.rows.get('l2').status, 'not_yet');
});

test('reading.memorization: 서버 목록으로 시작하면 그 상태가 보이고 기기의 미전송 값이 있으면 그것이 우선이다', async () => {
  const p = phone({ offline: true });
  await createMemorizationSync({ storage: p.storage, send: p.send, initial: [] }).set('l3', 'memorized');
  p.state.offline = false;
  const sync = createMemorizationSync({ storage: p.storage, send: p.send, initial: [entry('l3', 'not_yet'), entry('l4', 'memorized')] });
  await sync.restore();
  assert.equal(sync.status('l3'), 'memorized');
  assert.equal(sync.status('l4'), 'memorized');
  assert.equal(sync.status('l5'), null, '행이 없으면 아직 표시하지 않은 줄');
});
