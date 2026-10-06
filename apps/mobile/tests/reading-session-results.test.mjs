import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { directionLabel, flowRows, readDialogueCount, reportCompletion } from '../lib/reading/session-results.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const LINES = [X('옥상'), D('윤서', '하나'), D('태오', '둘'), X('사이'), D('윤서', '셋'), D('태오', '넷'), D('윤서', '다섯')];
const IDS = LINES.map((_, i) => `l${i}`);
const L4 = { line_id: 'l4', dialogue_no: 3, said: '세엣', different_words: [{ text: '셋', differs: true }] };
const L6 = { line_id: 'l6', dialogue_no: 5, said: null, different_words: [{ text: '다섯', differs: false }] };

test('reading.session: 대본 흐름(R9.26)은 구간 줄 전부를 순서대로 주고 서버가 다르게 말했다고 한 줄에만 그 결과가 붙는다', () => {
  const rows = flowRows({ lines: LINES, lineIds: IDS, startIndex: 3, endIndex: 6, myRoles: ['윤서'], different: [L4, L6] });
  assert.deepEqual(
    rows.map((r) => [r.lineId, r.line.type, r.mine, r.different?.said ?? null]),
    [
      ['l3', 'direction', false, null],
      ['l4', 'dialogue', true, '세엣'],
      ['l5', 'dialogue', false, null],
      ['l6', 'dialogue', true, null],
    ],
  );
  assert.equal(rows[3].different, L6, '말한 것이 없어도 다르게 말한 줄로 남는다');
});

const SAVED = { current_line_id: null, elapsed_seconds: 20, progress_seq: 2, status: 'completed', different_lines: [L4] };
const COMPLETE = { progress_seq: 2, complete: true, line_results: [{ line_id: 'l4', said: '세엣' }] };

function harness(send, detail = { different_lines: [L4, L6] }) {
  const views = [];
  const save = reportCompletion(send, { fetchDetail: async () => detail, onView: (v) => views.push(v) });
  return { save, views };
}

test('reading.session: 완료 저장 응답의 different_lines 가 완료 화면 칸이 된다. 진행 저장(완료 아님)은 칸을 건드리지 않는다', async () => {
  const { save, views } = harness(async () => SAVED);
  assert.equal(await save({ progress_seq: 1, line_results: [] }), SAVED);
  assert.deepEqual(views, []);
  assert.equal(await save(COMPLETE), SAVED);
  assert.deepEqual(views, [{ kind: 'ready', lines: [L4] }]);
});

test('reading.session: 완료 저장이 끊기면 later 로 알리고 오류를 그대로 던져 큐가 다시 보낸다', async () => {
  const offline = new NetworkError();
  const { save, views } = harness(async () => {
    throw offline;
  });
  await assert.rejects(save(COMPLETE), (e) => e === offline);
  assert.deepEqual(views, [{ kind: 'later' }]);
});

test('reading.session: 완료 응답을 잃어 다시 보낸 저장이 409 session_closed 면 회차 상세의 different_lines 를 쓴다', async () => {
  const closed = new ApiError(409, '닫힘', 'session_closed');
  const { save, views } = harness(async () => {
    throw closed;
  });
  await assert.rejects(save(COMPLETE), (e) => e === closed);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(views, [{ kind: 'ready', lines: [L4, L6] }]);

  const gone = harness(async () => {
    throw closed;
  }, null);
  await assert.rejects(gone.save(COMPLETE));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(gone.views, [{ kind: 'later' }], '회차 상세도 못 읽으면 later');
});

test('reading.session: 읽은 대사는 구간 안 대사 줄 수다(부분 구간을 대본 전체 완료로 말하지 않는다)', () => {
  assert.equal(readDialogueCount(LINES, 1, 6), 5);
  assert.equal(readDialogueCount(LINES, 4, 6), 3);
});

test('reading.session: 대본 흐름의 지문은 괄호에 싸서 보인다(이미 싸여 있으면 그대로)', () => {
  assert.equal(directionLabel('사이. 태오가 난간에 기댄다.'), '(사이. 태오가 난간에 기댄다.)');
  assert.equal(directionLabel('(웃으며)'), '(웃으며)');
});

test('reading.session: 완료 저장이 다시 보내도 답이 같은 오류(404·422·403)면 칸을 숨긴다 — 「연결되면」을 띄우지 않는다', async () => {
  for (const [status, code] of [[404, 'session_not_found'], [422, 'invalid_line'], [403, 'forbidden']]) {
    const failed = new ApiError(status, code, code);
    const { save, views } = harness(async () => {
      throw failed;
    });
    await assert.rejects(save(COMPLETE), (e) => e === failed);
    assert.deepEqual(views, [{ kind: 'hidden' }], `${status}`);
  }
});
