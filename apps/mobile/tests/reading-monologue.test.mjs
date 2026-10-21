import assert from 'node:assert/strict';
import test from 'node:test';

import { alignSentences, isMonologue, livePosition, monologueResults, similarity } from '../lib/reading/monologue.ts';

const SENTENCES = ['그래서 더 말하기 싫었어.', '네가 그걸 아니까.', '나도 내가 얼마나 준비했는지 알아.', '그래서 더 아팠어.'];

test('SOMA-597: 배역이 하나뿐인 대본만 독백이다 — 묶음 배역은 세지 않는다', () => {
  assert.equal(isMonologue([{ id: 'a', member_ids: [] }]), true);
  assert.equal(isMonologue([{ id: 'a' }, { id: 'b' }]), false);
  assert.equal(isMonologue([{ id: 'a' }, { id: 'g', member_ids: ['a', 'b'] }]), true);
  assert.equal(isMonologue([]), false);
});

test('SOMA-597: 끝까지 제대로 읽으면 모든 문장이 맞게 읽음이다 — 받아쓰기가 문장 사이를 이어 붙이고 문장부호를 빼도', () => {
  const aligned = alignSentences(SENTENCES, '그래서 더 말하기 싫었어 네가 그걸 아니까 나도 내가 얼마나 준비했는지 알아 그래서 더 아팠어');
  assert.deepEqual(aligned.map((a) => a.status), ['read', 'read', 'read', 'read']);
  assert.deepEqual(aligned.map((a) => a.said), ['그래서 더 말하기 싫었어', '네가 그걸 아니까', '나도 내가 얼마나 준비했는지 알아', '그래서 더 아팠어']);
});

test('SOMA-597: 빠뜨린 문장만 빠뜨림이고 그 문장의 말한 것은 비어 있다. 바꿔 말한 문장은 다르게 읽음이다', () => {
  const skipped = alignSentences(SENTENCES, '그래서 더 말하기 싫었어 네가 그걸 아니까 그래서 더 아팠어');
  assert.deepEqual(skipped.map((a) => a.status), ['read', 'read', 'missed', 'read']);
  assert.equal(skipped[2].said, '');

  const changed = alignSentences(SENTENCES, '그래서 더 말하기 싫었어 네가 그걸 아니까 나도 얼마나 힘들었는지 알아 그래서 더 아팠어');
  assert.deepEqual(changed.map((a) => a.status), ['read', 'read', 'different', 'read']);
});

test('SOMA-597: 아무 말도 받아쓰지 못했으면 모두 빠뜨림이다. 글자가 없는 문장(괄호 지시뿐)은 맞게 읽음이다', () => {
  assert.deepEqual(alignSentences(SENTENCES, '').map((a) => a.status), ['missed', 'missed', 'missed', 'missed']);
  assert.deepEqual(alignSentences(['(웃는다)', '안녕.'], '안녕').map((a) => a.status), ['read', 'read']);
});

test('SOMA-597: 읽는 위치 — 다 읽은 문장 다음으로 강조가 옮겨 가고, 문장 중간이면 그 문장이다. 뒤로 가지 않는다', () => {
  assert.equal(livePosition(SENTENCES, '', 0), 0);
  assert.equal(livePosition(SENTENCES, '그래서 더 말하기', 0), 0);
  assert.equal(livePosition(SENTENCES, '그래서 더 말하기 싫었어', 0), 1);
  assert.equal(livePosition(SENTENCES, '그래서 더 말하기 싫었어 네가 그걸 아니까 나도', 0), 2);
  assert.equal(livePosition(SENTENCES, '그래서 더 말하기', 2), 2, '앞 위치보다 뒤로 가지 않는다');
  assert.equal(livePosition(SENTENCES, '그래서 더 말하기 싫었어 네가 그걸 아니까 나도 내가 얼마나 준비했는지 알아 그래서 더 아팠어', 0), 3, '마지막 문장에 머문다');
});

test('SOMA-597: 결과 — 빠뜨린 수와 진행 저장의 줄 결과(빠뜨린 문장은 싣지 않는다)', () => {
  const ids = ['l1', 'l2', 'l3', 'l4'];
  const result = monologueResults(ids, SENTENCES, '그래서 더 말하기 싫었어 네가 그걸 아니까 그래서 더 아팠어');
  assert.equal(result.missed, 1);
  assert.deepEqual(result.rows.map((r) => `${r.lineId}|${r.status}`), ['l1|read', 'l2|read', 'l3|missed', 'l4|read']);
  assert.deepEqual(result.said, { l1: '그래서 더 말하기 싫었어', l2: '네가 그걸 아니까', l4: '그래서 더 아팠어' });
});

test('SOMA-597: 가까움은 서버 LineMatch 와 같은 자모 편집 거리다', () => {
  assert.equal(similarity('네가 그걸 아니까', '네가 그걸 아니까.'), 1);
  assert.ok(similarity('네가 그걸 알았니', '네가 그걸 아니까.') < 0.9);
  assert.equal(similarity('', ''), 1);
});

test('SOMA-597: 끝내기는 말한 것을 싣고 실행을 끝낸다 — 진행 저장 줄 결과가 된다. 문장 목록은 처음 들은 줄부터 구간 끝까지의 대사', async () => {
  const { createRun, progressPayload } = await import('../lib/reading/session-run.ts');
  const { finishMonologueRun, sentenceIndexes } = await import('../lib/reading/monologue.ts');
  const lines = [{ type: 'direction', text: '옥상' }, ...SENTENCES.map((text) => ({ type: 'dialogue', role: '민지', text }))];
  const run = createRun({ lines, lineIds: ['l0', 'l1', 'l2', 'l3', 'l4'], myRoles: ['민지'], startIndex: 0, endIndex: 4 });
  assert.deepEqual(sentenceIndexes(run, 0), [1, 2, 3, 4]);
  assert.deepEqual(sentenceIndexes(run, 3), [3, 4]);
  const done = finishMonologueRun(run, { l1: '그래서 더 말하기 싫었어' });
  assert.equal(done.status, 'done');
  assert.deepEqual(progressPayload(done), {
    current_line_id: null,
    elapsed_seconds: 0,
    line_results: [{ line_id: 'l1', said: '그래서 더 말하기 싫었어' }],
    complete: true,
  });
  assert.equal(finishMonologueRun(done, { l2: 'x' }), done);
});
