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
  recordMatch,
  resultsFromSession,
  resumeRun,
  shownText,
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
    ...overrides,
  });
}

test('reading.session: 진행 "K / N"은 대사 줄만 센다 — 대사 5개·지문 2개 구간은 N = 5', () => {
  const r = run();
  assert.deepEqual(progressOf(r), { done: 0, total: 5 });
  assert.equal(formatProgress(r), '0 / 5 · 00:00');
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
  assert.equal(formatProgress(r), '0 / 5 · 00:01');
});

test('reading.session: 대조 미달은 흐름을 바꾸지 않고 unmatched 와 말한 것만 남긴다. 서버 본문엔 말한 것이 없다', () => {
  let r = run();
  r = recordMatch(r, 'miss', '하나');
  assert.equal(r.index, 1);
  assert.deepEqual(r.results, { l1: { outcome: 'unmatched', misses: 1, said: '하나' } });
  assert.deepEqual(lineResultsOf(r), [{ line_id: 'l1', outcome: 'unmatched', misses: 1 }]);
  r = recordMatch(r, 'pass', '1');
  assert.deepEqual(r.results.l1, { outcome: 'passed', misses: 1, said: '1' }, '다시 말해 통과하면 마지막 사건이 이긴다');
  const partner = advance(r);
  assert.equal(recordMatch(partner, 'miss', 'x'), partner, '상대 차례에는 결과를 남기지 않는다');
});

test('reading.session: 이어하기는 서버 결과에 녹음 전사를 붙인다 — 같은 줄은 attempt_no 가 큰 쪽', () => {
  const results = resultsFromSession({
    line_results: [
      { line_id: 'l1', outcome: 'unmatched', misses: 1 },
      { line_id: 'l4', outcome: 'passed', misses: 0 },
    ],
    recordings: [
      { line_id: 'l1', attempt_no: 1, transcript: '첫 번째' },
      { line_id: 'l1', attempt_no: 2, transcript: '두 번째' },
    ],
  });
  assert.deepEqual(results, {
    l1: { outcome: 'unmatched', misses: 1, said: '두 번째' },
    l4: { outcome: 'passed', misses: 0, said: null },
  });
  assert.deepEqual(resultsFromSession({ line_results: null, recordings: null }), {});
});

test('reading.session: 가리기 — 내 대사만/모든 대사, 배역 이름·지문·장면은 남긴다', () => {
  const mine = { line: D('윤서', 'x'), isMine: true };
  const partner = { line: D('태오', 'y'), isMine: false };
  const direction = { line: X('z'), isMine: false };
  assert.equal(isHidden({ maskMode: 'none', ...mine }), false);
  assert.equal(isHidden({ maskMode: 'mine', ...mine }), true);
  assert.equal(isHidden({ maskMode: 'mine', ...partner }), false);
  assert.equal(isHidden({ maskMode: 'all', ...partner }), true);
  assert.equal(isHidden({ maskMode: 'all', ...direction }), false, '지문은 남긴다');
});

test('reading.session: 가린 줄의 보조 — [첫 단어]는 첫 어절만, [원문 보기]는 전부, 없으면 아무 글자도 없다', () => {
  assert.equal(shownText('어떻게 알았어.', true, 'none'), null);
  assert.equal(shownText('어떻게 알았어.', true, 'first_word'), '어떻게');
  assert.equal(shownText('  어떻게 알았어.', true, 'first_word'), '어떻게');
  assert.equal(shownText('어떻게 알았어.', true, 'original'), '어떻게 알았어.');
  assert.equal(shownText('어떻게 알았어.', false, 'none'), '어떻게 알았어.', '안 가린 줄은 그대로');
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
