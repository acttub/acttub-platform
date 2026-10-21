import assert from 'node:assert/strict';
import test from 'node:test';

import { api, httpResponses, id } from './helpers/practice-api.mjs';
import { observedSceneLine } from '../lib/practice/analysis-summary.ts';
import { helpButtonDraft } from '../lib/practice/coach.ts';

/**
 * SOMA-778 — 코치 화면 위 한 줄 「AI가 본 장면 · …」은 분석 공개 요약(`GET /v2/practices/{id}/analysis`)의
 * observed_scene(VideoRecordSummaryResponse)을 쓴다. 없으면 줄을 숨긴다.
 */

const summary = (over = {}) => ({
  schema_version: 'acttub.video_record_summary.v1',
  record_id: id(7),
  record_version: 1,
  duration_ms: 48_000,
  status: 'ready',
  processed_ranges: [{ start_ms: 0, end_ms: 48_000 }],
  missing_ranges: [],
  observed_scene: ['카페에서 컵을 내려놓고 헤어지자는 말을 꺼낸다', '상대를 보지 않는다'],
  spoken_content: [],
  limitations: [],
  ...over,
});

test('분석 요약을 서버 계약 그대로 읽는다', async t => {
  const calls = httpResponses(t, [
    { path: `/v2/practices/${id(1)}/analysis`, body: { id: id(7), format: 'video_record_v1', status: 'ready', summary: summary() } },
  ]);
  const analysis = await api.getPracticeAnalysis(id(1));
  assert.equal(calls[0].method, 'get');
  assert.equal(observedSceneLine(analysis), '카페에서 컵을 내려놓고 헤어지자는 말을 꺼낸다');
});

test('본 장면 한 줄: 첫 문장만, 줄바꿈·겹친 공백은 한 칸으로', () => {
  const analysis = (observed) => ({ id: 'a', format: 'video_record_v1', status: 'ready', summary: summary({ observed_scene: observed }) });
  assert.equal(observedSceneLine(analysis(['  ', '  창가에서\n  혼잣말을   한다 '])), '창가에서 혼잣말을 한다');
  assert.equal(observedSceneLine(analysis([])), null);
  assert.equal(observedSceneLine(analysis(['   '])), null);
});

test('본 장면이 없는 요약(옛 갈래·빈 값·모르는 모양)이면 줄을 숨긴다', () => {
  assert.equal(observedSceneLine(null), null);
  assert.equal(observedSceneLine({ id: 'a', format: 'legacy', status: 'ready', summary: { scene: '무언가' } }), null);
  assert.equal(observedSceneLine({ id: 'a', format: 'video_record_v1', status: 'ready', summary: null }), null);
  assert.equal(observedSceneLine({ id: 'a', format: 'video_record_v1', status: 'ready', summary: { observed_scene: '문자열' } }), null);
  assert.equal(observedSceneLine({ id: 'a', format: 'video_record_v1', status: 'ready', summary: { observed_scene: [3, '  보인다 '] } }), '보인다');
});

test('빠른 답 「잘 모르겠어요」도 입력칸만 채운다', () => {
  assert.equal(helpButtonDraft('unsure'), '잘 모르겠어요');
  assert.equal(helpButtonDraft('yes'), '맞아요');
  assert.equal(helpButtonDraft('no'), '아니요');
});
