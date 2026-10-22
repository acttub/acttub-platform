import assert from 'node:assert/strict';
import test from 'node:test';

import { lineGroups } from '../lib/reading/line-groups.ts';
import { advance, back, canGoBack, createRun, jumpTo, progressOf, progressPayload, recordSaid, resumeRun, turnOf, turnSpan } from '../lib/reading/session-run.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const S = (text) => ({ type: 'scene', text });

// 스펙 예시(SOMA-806) — 저장된 그대로의 여섯 줄.
const LINES = [
  D('철수', '야, 어디 가?'),
  D('철수', '잠깐만 기다려 봐.'),
  X('(영희, 대답 없이 걸어간다)'),
  D('철수', '나도 같이 가자.'),
  D('철수', '왜 대답을 안 해?'),
  D('영희', '싫어.'),
];
const IDS = LINES.map((_, i) => `l${i + 1}`);
const spans = (groups) => groups.map((g) => [g.start, g.end]);

test('같은 배역 연속 대사는 한 묶음이고 지문에서 끊긴다', () => {
  assert.deepEqual(spans(lineGroups(LINES, { monologue: false })), [[0, 1], [2, 2], [3, 4], [5, 5]]);
});

test('장면 줄에서도 끊긴다', () => {
  assert.deepEqual(spans(lineGroups([D('철수', 'a'), S('2장'), D('철수', 'b')], { monologue: false })), [[0, 0], [1, 1], [2, 2]]);
});

test('뒤 줄의 배역을 바꾸면 따로 보이고 다음 같은 배역과 다시 묶인다', () => {
  const edited = LINES.map((l, i) => (i === 4 ? D('영희', l.text) : l));
  assert.deepEqual(spans(lineGroups(edited, { monologue: false })), [[0, 1], [2, 2], [3, 3], [4, 5]]);
});

test('묶음 배역은 배역 id(이름)가 같을 때만 같은 배역이다', () => {
  const lines = [D('민재', 'a'), D('민재, 서연', 'b'), D('민재, 서연', 'c'), D('서연', 'd')];
  assert.deepEqual(spans(lineGroups(lines, { monologue: false })), [[0, 0], [1, 2], [3, 3]]);
});

test('배역 이름이 비어 있는 줄은 묶지 않는다', () => {
  assert.deepEqual(spans(lineGroups([D('', 'a'), D('', 'b')], { monologue: false })), [[0, 0], [1, 1]]);
});

test('독백은 묶지 않는다', () => {
  const lines = [D('민지', '첫 문장.'), D('민지', '둘째 문장.'), D('민지', '셋째 문장.')];
  assert.deepEqual(spans(lineGroups(lines, { monologue: true })), [[0, 0], [1, 1], [2, 2]]);
  const run = createRun({ lines, lineIds: ['a', 'b', 'c'], myRoles: ['민지'], startIndex: 0, endIndex: 2, monologue: true });
  assert.deepEqual(turnSpan(run), { start: 0, end: 0 });
  assert.equal(advance(run).index, 1);
});

function run(overrides = {}) {
  return createRun({ lines: LINES, lineIds: IDS, myRoles: ['영희'], startIndex: 0, endIndex: LINES.length - 1, ...overrides });
}

test('실행: 묶음이 한 차례다 — 상대 묶음을 이어 읽고 다음 묶음으로 간다', () => {
  let r = run();
  assert.equal(turnOf(r), 'partner');
  assert.deepEqual(turnSpan(r), { start: 0, end: 1 });
  r = advance(r);
  assert.equal(r.index, 3);
  assert.deepEqual(turnSpan(r), { start: 3, end: 4 });
  // 진행 K 는 지난 대사 줄 수 그대로다.
  assert.deepEqual(progressOf(r), { done: 2, total: 5 });
  assert.equal(progressPayload(r).current_line_id, 'l4');
  r = advance(r);
  assert.equal(r.index, 5);
  assert.equal(turnOf(r), 'mine');
  assert.equal(advance(r).status, 'done');
});

test('실행: 침묵과 버튼이 겹쳐도 한 차례만 넘어간다', () => {
  const r = advance(run(), 0);
  assert.equal(r.index, 3);
  assert.equal(advance(r, 0), r);
});

test('실행: [이전]·지나간 대사 누르기는 묶음 처음으로 간다', () => {
  let r = advance(advance(run()));
  assert.equal(r.index, 5);
  r = back(r);
  assert.equal(r.index, 3);
  r = back(r);
  assert.equal(r.index, 0);
  assert.equal(canGoBack(r), false);
  const last = advance(advance(run()));
  assert.equal(jumpTo(last, 4).index, 3);
  assert.equal(jumpTo(last, 1).index, 0);
});

test('실행: 구간이 묶음 가운데서 시작·끝나면 구간까지만 한 차례다', () => {
  const r = run({ startIndex: 1, endIndex: 3 });
  assert.deepEqual(turnSpan(r), { start: 1, end: 1 });
  const next = advance(r);
  assert.deepEqual(turnSpan(next), { start: 3, end: 3 });
  assert.equal(back(next).index, 1);
});

test('실행: 이어하기의 앞 상대 대사는 상대 묶음 전체다', () => {
  const r = resumeRun(run({ myRoles: ['철수'], lines: [D('영희', 'a'), D('영희', 'b'), D('철수', 'c')], lineIds: ['a', 'b', 'c'], endIndex: 2 }), 'c');
  assert.equal(r.index, 0);
  assert.equal(r.leadInUntil, 2);
  assert.equal(advance(r).index, 2);
});

test('내 묶음을 한 번에 말하면 줄마다 떼어 남기고 진행 저장의 줄 결과도 줄별이다', () => {
  let r = run({ myRoles: ['철수'] });
  assert.equal(turnOf(r), 'mine');
  r = recordSaid(r, '야 어디 가 잠깐만 기다려 봐');
  assert.deepEqual(r.said, { l1: '야 어디 가', l2: '잠깐만 기다려 봐' });
  r = advance(r);
  // 둘째 줄을 빠뜨림: 첫 줄에만 남는다(서버도 무발화는 넣지 않는다).
  r = recordSaid(r, '나도 같이 가자');
  assert.equal(r.said.l4, '나도 같이 가자');
  assert.equal(r.said.l5, undefined);
  assert.deepEqual(progressPayload(r).line_results.map((x) => x.line_id), ['l1', 'l2', 'l4']);
});

test('묶음 어느 줄에도 맞지 않는 말은 첫 줄의 말한 것이다', () => {
  const r = recordSaid(run({ myRoles: ['철수'] }), '전혀 다른 말');
  assert.deepEqual(r.said, { l1: '전혀 다른 말' });
});

test('묶이지 않은 내 줄은 받아쓴 글을 그대로 남긴다', () => {
  const r = recordSaid(advance(advance(run())), '시러');
  assert.deepEqual(r.said, { l6: '시러' });
});
