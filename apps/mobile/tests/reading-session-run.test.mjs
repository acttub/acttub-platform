import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advance,
  applyLineEdit,
  back,
  canGoBack,
  createRun,
  currentLineIdOf,
  exitMessage,
  formatProgress,
  isHidden,
  jumpTo,
  progressOf,
  pause,
  progressPayload,
  recordSaid,
  resumeRun,
  shownText,
  stopRun,
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

test('reading.session: 이어하기 앞 상대 대사를 읽는 동안 나가도 진행은 멈췄던 줄 그대로다 — 열고 나갈 때마다 한 줄씩 뒤로 가지 않는다(SOMA-822)', () => {
  // 폰 확인(10/24): 「진행 중 · 10/11」 회차를 열고 [시작] 전에 나가니 「9/11」로 줄었다. 머리도 「9 / 11」로 버튼과 어긋났다.
  const r = resumeRun(run(), 'l4');
  assert.equal(currentLineIdOf(r), 'l4', '저장 위치는 앞 상대 대사(l2)가 아니라 멈췄던 줄');
  assert.equal(progressPayload(r).current_line_id, 'l4');
  assert.deepEqual(progressOf(r), { done: 2, total: 5 });
  assert.equal(formatProgress(r), '2 / 5 · 00:00', '머리 숫자도 회차 버튼(끝낸 줄 수)과 같다');
});

test('reading.session: 나가기 확인 문구는 "지금 나가면 N번 대사까지 진행한 걸로 저장돼요"다', () => {
  let r = run();
  r = advance(advance(r));
  assert.equal(exitMessage(r), '지금 나가면 2번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.');
});

test('reading.session: 나가기 확인 숫자는 화면 "K / N" 의 K 와 같다(구간이 중간에서 시작해도)', () => {
  let r = run({ startIndex: 4 }); // 대본 3번째 대사부터
  assert.equal(exitMessage(r), '지금 나가면 0번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.');
  r = advance(r);
  assert.equal(progressOf(r).done, 1);
  assert.equal(exitMessage(r), '지금 나가면 1번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.');
});

test('reading.session: 이전 — 바로 앞 대사 줄로 돌아가고 지문은 건너뛴다, 차례는 그 줄 배역으로', () => {
  let r = run(); // l1 윤서(내 줄)
  r = advance(r); // l2 태오
  r = advance(r); // l4 윤서 (l3 지문 건너뜀)
  assert.equal(r.index, 4);
  const b = back(r);
  assert.equal(b.index, 2, '지문 l3을 건너뛰어 l2로');
  assert.equal(b.status, 'partner');
  assert.deepEqual(progressOf(b), { done: 1, total: 5 });
  assert.equal(currentLineIdOf(b), 'l2');
  assert.equal(back(b).status, 'mine');
});

test('reading.session: 이전 — 구간 첫 대사·완료·일시정지에서는 안 된다', () => {
  const first = run();
  assert.equal(canGoBack(first), false);
  assert.equal(back(first), first, '첫 대사에서는 그대로');
  const later = advance(first);
  assert.equal(canGoBack(later), true);
  const narrowed = run({ startIndex: 4 });
  assert.equal(canGoBack(narrowed), false, '구간 밖(앞) 대사로는 못 간다');
  let done = run();
  for (let i = 0; i < 5; i++) done = advance(done);
  assert.equal(done.status, 'done');
  assert.equal(canGoBack(done), false);
  const paused = { ...later, status: 'paused', resumeTo: later.status };
  assert.equal(canGoBack(paused), false);
  assert.equal(back(paused), paused);
});

test('reading.session: 이전 — 말한 것은 남기고 다시 말하면 마지막 말이 이긴다', () => {
  let r = recordSaid(run(), '첫 시도');
  r = back(advance(r));
  assert.equal(r.index, 1);
  assert.equal(r.said.l1, '첫 시도');
  r = recordSaid(r, '두 번째');
  assert.equal(r.said.l1, '두 번째');
});

test('reading.session: 리딩 중 줄 고치기 — 글을 고치면 같은 줄을 처음부터, 종류가 대사가 아니게 되면 다음 대사로(SOMA-728)', () => {
  let r = advance(run()); // l2 태오(상대)
  const edited = LINES.map((l, i) => (i === 2 ? D('태오', '고친 2') : l));
  const a = applyLineEdit(r, { lines: edited, lineIds: IDS, myRoles: ['윤서'] });
  assert.equal(a.index, 2);
  assert.equal(a.lines[2].text, '고친 2');
  assert.equal(a.status, 'partner');

  const toDirection = LINES.map((l, i) => (i === 2 ? X('2를 지문으로') : l));
  const b = applyLineEdit(r, { lines: toDirection, lineIds: IDS, myRoles: ['윤서'] });
  assert.equal(b.index, 4, '지문이 된 줄을 건너 다음 대사로');
  assert.equal(b.status, 'mine');
  assert.deepEqual(progressOf(b), { done: 1, total: 4 });
});

test('reading.session: 줄 고치기 — 배역이 바뀌면 차례도 바뀌고, 멈춘 상태는 그대로 멈춰 있다가 새 차례로 재개한다', () => {
  const paused = { ...advance(run()), status: 'paused', resumeTo: 'partner' };
  const mine = LINES.map((l, i) => (i === 2 ? D('윤서', '2') : l));
  const a = applyLineEdit(paused, { lines: mine, lineIds: IDS, myRoles: ['윤서'] });
  assert.equal(a.status, 'paused');
  assert.equal(a.resumeTo, null, '재개할 때 차례를 새로 정한다');
  assert.equal(turnOf(a), 'mine');
});

test('reading.session: 줄 고치기 — 대사가 아니게 된 줄의 말한 기록은 버린다(서버는 대사 줄이 아닌 결과를 422 로 거절한다)', () => {
  let r = recordSaid(run(), '말함'); // l1
  r = advance(r);
  const toScene = LINES.map((l, i) => (i === 1 ? { type: 'scene', text: '장면' } : l));
  const a = applyLineEdit(r, { lines: toScene, lineIds: IDS, myRoles: ['윤서'] });
  assert.equal(a.said.l1, undefined);
  assert.deepEqual(progressPayload(a).line_results, []);
});

test('reading.session: 줄 고치기 — 마지막 대사를 대사가 아니게 바꾸면 앞 대사로, 대사가 하나도 없으면 끝', () => {
  let r = run();
  for (let i = 0; i < 4; i++) r = advance(r); // l7 윤서(마지막)
  assert.equal(r.index, 7);
  const lastToDir = LINES.map((l, i) => (i === 7 ? X('끝말') : l));
  const a = applyLineEdit(r, { lines: lastToDir, lineIds: IDS, myRoles: ['윤서'] });
  assert.equal(a.index, 5);
  const none = LINES.map((l) => (l.type === 'dialogue' ? X(l.text) : l));
  assert.equal(applyLineEdit(r, { lines: none, lineIds: IDS, myRoles: ['윤서'] }).status, 'done');
});

test('reading.session(SOMA-785): 지나간 대사를 누르면 그 줄로 가 처음부터 다시 하고, 말한 것은 남는다', () => {
  let r = advance(advance(recordSaid(run(), '하나'))); // l1(내 줄)을 말하고 l2·l4 를 지나 l4 에서
  assert.equal(r.index, 4);
  const jumped = jumpTo(r, 2);
  assert.equal(jumped.index, 2);
  assert.equal(jumped.status, 'partner', '상대 줄이면 다시 읽는다');
  assert.equal(jumpTo(r, 1).status, 'mine', '내 줄이면 다시 듣는다');
  assert.deepEqual(jumpTo(r, 1).said, { l1: '하나' });
  assert.equal(progressPayload(jumped).current_line_id, 'l2', '진행 위치도 그 줄이다');
});

test('reading.session(SOMA-785): 지문·구간 밖·지금 줄과 뒤 줄·끝난 실행으로는 가지 않고, 멈춘 채 누르면 그 줄에서 이어 한다', () => {
  const r = advance(advance(run()));
  assert.equal(jumpTo(r, 3), r, '지문');
  assert.equal(jumpTo(r, 0), r, '구간 앞');
  assert.equal(jumpTo(r, 4), r, '지금 줄');
  assert.equal(jumpTo(r, 5), r, '뒤 줄');
  const done = { ...r, status: 'done' };
  assert.equal(jumpTo(done, 1), done);
  const paused = { ...r, status: 'paused', resumeTo: 'mine' };
  const resumed = jumpTo(paused, 2);
  assert.equal(resumed.status, 'partner');
  assert.equal(resumed.resumeTo, null);
  const leadIn = { ...r, leadInUntil: 5 };
  assert.equal(jumpTo(leadIn, 2).leadInUntil, null, '이어하기 앞 상대 대사보다 앞으로 가도 위치를 저장한다');
});

test('reading.session: 멈춘 채 그만하기 — 마지막으로 지나간 줄까지로 끝내고 완료로 보낸다', () => {
  const at3 = advance(advance(run())); // 윤서 '3'(index 4)
  assert.equal(at3.index, 4);
  const stopped = stopRun(pause(at3));
  assert.equal(stopped.status, 'done');
  assert.equal(stopped.endIndex, 3);
  assert.equal(stopped.index, 4);
  assert.equal(currentLineIdOf(stopped), null);
  assert.equal(progressPayload(stopped).complete, true);
});

test('reading.session: 그만하기 — 지금 차례에 말한 게 있으면 그 차례까지 읽은 것으로 친다', () => {
  const at3 = recordSaid(advance(advance(run())), '삼');
  const stopped = stopRun(pause(at3));
  assert.equal(stopped.endIndex, 4);
  assert.equal(stopped.said.l4, '삼');
});

test('reading.session: 그만하기 — 첫 줄에서 멈추면 읽은 줄이 없다(endIndex = startIndex - 1)', () => {
  const stopped = stopRun(pause(run()));
  assert.equal(stopped.endIndex, 0);
  assert.equal(stopped.status, 'done');
  assert.equal(stopRun(stopped), stopped);
});
