import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advance,
  createRun,
  currentLineIdOf,
  exitMessage,
  formatProgress,
  isHidden,
  progressOf,
  progressPayload,
  recordSaid,
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

test('reading.session: 내 줄에는 말한 것만 남기고 흐름은 그대로다. 진행 저장은 이번 실행에서 말한 줄만 줄 순서로 line_id·said 를 싣는다', () => {
  assert.deepEqual(progressPayload(resumeRun(run(), 'l4')).line_results, [], '이어하기는 앞 실행의 줄 결과를 다시 보내지 않는다(서버가 말한 것을 지우지 않게)');
  let r = run();
  r = recordSaid(r, '하나');
  assert.equal(r.index, 1);
  r = recordSaid(r, '일');
  const partner = advance(r);
  assert.equal(recordSaid(partner, 'x'), partner, '상대 차례에는 남기지 않는다');
  r = recordSaid(advance(partner), '셋');
  assert.deepEqual(progressPayload(r), {
    current_line_id: 'l4',
    elapsed_seconds: 0,
    line_results: [
      { line_id: 'l1', said: '일' },
      { line_id: 'l4', said: '셋' },
    ],
    complete: false,
  });
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

test('reading.session: [첫 단어]는 대사 앞 괄호 지문을 통째로 보이고 그 뒤 한 어절까지 보인다', () => {
  assert.equal(shownText('(무감정한 눈빛으로) 근데 오늘은 그 친구, 없네?', true, 'first_word'), '(무감정한 눈빛으로) 근데');
  assert.equal(shownText('(웃으며) 그런가.', true, 'first_word'), '(웃으며) 그런가.');
  assert.equal(shownText('(작게) [돌아서며] 응.', true, 'first_word'), '(작게) [돌아서며] 응.', '이어진 괄호는 모두');
  assert.equal(shownText('（한참 보다가） 고마워.', true, 'first_word'), '（한참 보다가） 고마워.', '전각 괄호');
  assert.equal(shownText('(끄덕)', true, 'first_word'), '(끄덕)', '괄호만 있는 대사');
  assert.equal(shownText('근데 (사이) 없네?', true, 'first_word'), '근데', '중간 괄호는 보통 첫 어절');
  assert.equal(shownText('(무감정한 눈빛으로 근데', true, 'first_word'), '(무감정한', '닫히지 않은 괄호는 보통 첫 어절');
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
