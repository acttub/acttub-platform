import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advance,
  createRun,
  currentLineIdOf,
  exitMessage,
  formatProgress,
  isHidden,
  lineResultsOf,
  progressOf,
  quizMiss,
  quizPass,
  quizSkip,
  readMiss,
  resumeRun,
  tickElapsed,
  turnOf,
} from '../lib/reading/session-run.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const LINES = [X('옥상'), D('윤서', '1'), D('태오', '2'), X('사이'), D('윤서', '3'), D('태오', '4'), X('끝'), D('윤서', '5')];
const IDS = LINES.map((_, i) => `l${i}`);

function run(overrides = {}) {
  return createRun({
    lines: LINES,
    lineIds: IDS,
    myRoles: ['윤서'],
    startIndex: 1,
    endIndex: 7,
    mode: 'read',
    ...overrides,
  });
}

test('reading.session: 진행 "K / N"은 대사 줄만 센다 — 대사 5개·지문 2개 구간은 N = 5', () => {
  const r = run();
  assert.deepEqual(progressOf(r), { done: 0, total: 5 });
  assert.equal(formatProgress(r, 0), '0 / 5 · 00:00');
  assert.equal(r.index, 1, '구간의 첫 대사 줄에서 시작');
  assert.equal(turnOf(r), 'mine');
});

test('reading.session: 지문은 진행에서 건너뛰고 화면에만 보인다 — 넘기면 다음 대사 줄로 간다', () => {
  let r = advance(run());
  assert.equal(r.index, 2);
  assert.equal(turnOf(r), 'partner');
  r = advance(r);
  assert.equal(r.index, 4, '지문(3)을 건너뛴다');
  assert.deepEqual(progressOf(r), { done: 2, total: 5 });
});

test('reading.session: 구간 마지막 대사를 넘기면 completed 이고 진행은 N / N, 현재 줄은 null 이다', () => {
  let r = run();
  for (let i = 0; i < 5; i++) r = advance(r);
  assert.equal(r.status, 'done');
  assert.deepEqual(progressOf(r), { done: 5, total: 5 });
  assert.equal(currentLineIdOf(r), null);
  assert.equal(currentLineIdOf(run()), 'l1');
  assert.equal(advance(r).status, 'done', '끝난 뒤 넘겨도 그대로');
});

test('reading.session: 침묵 완료와 버튼이 동시에 와도 한 줄만 넘어간다(같은 줄에 대한 넘김은 한 번)', () => {
  const r = run();
  const a = advance(r, r.index);
  const b = advance(a, r.index);
  assert.equal(a.index, 2);
  assert.equal(b.index, 2, '이미 지난 줄에 대한 두 번째 넘김은 무시');
});

test('reading.session: 흐른 시간은 일시정지를 빼고 잰다', () => {
  let r = run();
  r = tickElapsed(r, 1000);
  r = { ...r, status: 'paused' };
  r = tickElapsed(r, 30_000);
  r = { ...r, status: 'mine' };
  r = tickElapsed(r, 500);
  assert.equal(r.elapsedMs, 1500);
  assert.equal(formatProgress(r, r.elapsedMs), '0 / 5 · 00:01');
});

test('reading.session: quiz에서 한 줄을 2회 미달하면 다음 줄로 가고 line_results에 {unmatched, misses 2}', () => {
  let r = run({ mode: 'quiz' });
  r = quizMiss(r);
  assert.equal(r.index, 1, '첫 미달은 같은 줄에 머문다');
  assert.equal(r.pendingMiss, true, '"다시·넘어가기"가 보인다');
  r = quizMiss(r);
  assert.equal(r.index, 2, '2회 미달이면 안내 없이 넘어간다');
  assert.deepEqual(lineResultsOf(r), [{ line_id: 'l1', outcome: 'unmatched', misses: 2 }]);
});

test('reading.session: 첫 미달 뒤 통과하면 {passed, misses 1}, 넘어가기는 skipped', () => {
  let r = run({ mode: 'quiz' });
  r = quizMiss(r);
  r = quizPass(r);
  assert.deepEqual(lineResultsOf(r), [{ line_id: 'l1', outcome: 'passed', misses: 1 }]);
  assert.equal(r.index, 2);
  r = advance(r); // 상대 줄
  r = quizSkip(r);
  assert.deepEqual(lineResultsOf(r).at(-1), { line_id: 'l4', outcome: 'skipped', misses: 0 });
});

test('reading.session: read에서 대조 미달은 흐름을 바꾸지 않고 line_results에 unmatched 만 남긴다', () => {
  let r = run({ mode: 'read' });
  r = readMiss(r);
  assert.equal(r.index, 1);
  assert.equal(r.pendingMiss, false);
  assert.deepEqual(lineResultsOf(r), [{ line_id: 'l1', outcome: 'unmatched', misses: 1 }]);
});

test('reading.session: 가리기 — 내 대사만/모든 대사, 배역 이름·지문·장면은 남기고 quiz에서는 내 대사가 언제나 가려진다', () => {
  const mine = { line: D('윤서', 'x'), isMine: true };
  const partner = { line: D('태오', 'y'), isMine: false };
  const direction = { line: X('z'), isMine: false };
  assert.equal(isHidden({ mode: 'read', maskMode: 'none', ...mine }), false);
  assert.equal(isHidden({ mode: 'read', maskMode: 'mine', ...mine }), true);
  assert.equal(isHidden({ mode: 'read', maskMode: 'mine', ...partner }), false);
  assert.equal(isHidden({ mode: 'read', maskMode: 'all', ...partner }), true);
  assert.equal(isHidden({ mode: 'read', maskMode: 'all', ...direction }), false, '지문은 남긴다');
  assert.equal(isHidden({ mode: 'quiz', maskMode: 'none', ...mine }), true, 'quiz "모든 대사 보기"에서도 내 대사는 가려진다');
  assert.equal(isHidden({ mode: 'quiz', maskMode: 'none', ...partner }), false);
  assert.equal(isHidden({ mode: 'quiz', maskMode: 'none', ...mine, revealed: true }), false, '원문 보기는 현재 줄만 푼다');
});

test('reading.session: 이어하기는 current_line 부터 시작하고 그 줄 직전의 상대 대사 하나를 먼저 읽는다', () => {
  const r = resumeRun(run(), 'l4');
  assert.equal(r.index, 2, '직전 상대 대사(태오 2)');
  assert.equal(r.leadInUntil, 4);
  const next = advance(r);
  assert.equal(next.index, 4);
  assert.equal(next.leadInUntil, null);
  assert.deepEqual(progressOf(next), { done: 2, total: 5 });
});

test('reading.session: 나가기 확인 문구는 "지금 나가면 N번 대사까지 진행한 걸로 저장돼요"다', () => {
  let r = run();
  r = advance(advance(r));
  assert.equal(exitMessage(r), '지금 나가면 2번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.');
});
