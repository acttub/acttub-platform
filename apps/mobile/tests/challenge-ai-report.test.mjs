import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_REPORT_DAILY_LIMIT,
  AI_REPORT_MIN_SAMPLES,
  canRequest,
  evidenceLabel,
  evidenceStartSeconds,
  reportRequestFailure,
  reportSections,
  requestNotice,
  sampleNotice,
  statusMessage,
} from '../lib/challenge/ai-report.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });

const report = (over = {}) => ({
  entry_id: 'entry-1',
  status: 'ready',
  observations: [{ start_ms: 41_000, end_ms: 45_500, text: '말을 끝낸 직후 시선이 먼저 내려간다' }],
  comparisons: ['다른 참여작들은 대사 뒤에 한 박자를 두었고, 이 영상은 바로 돌아섰어요.'],
  limits: ['0:10–0:14 구간은 소리가 작아 보지 못했어요.'],
  suggestion: '대답하기 전에 2초를 더 듣고 시선을 든다.',
  sample_count: 5,
  requested_at: '2026-09-21T02:00:00Z',
  completed_at: '2026-09-21T02:03:00Z',
  ...over,
});

test('challenge.ai-report: 결과는 관찰·견주기·한계·제안이고 점수·순위가 없다', () => {
  const sections = reportSections(report());

  assert.deepEqual(sections.map((s) => s.kind), ['observations', 'comparisons', 'limits', 'suggestion']);
  // 랭킹과 다른 것이다 — 점수·등급·백분위·순위 문구를 만들지 않는다(ADR-005 개정).
  const text = JSON.stringify(sections);
  for (const banned of ['점수', '등급', '백분위', '순위', '잘했', '재능']) {
    assert.equal(text.includes(banned), false, `${banned} 문구가 들어갔다`);
  }
});

test('challenge.ai-report: 표본이 3개 미만이면 관찰만 두고 부족하다고 말한다', () => {
  assert.equal(AI_REPORT_MIN_SAMPLES, 3);
  assert.equal(sampleNotice(report({ sample_count: 5 })), null);
  assert.match(sampleNotice(report({ sample_count: 2 })), /부족/);

  const sections = reportSections(report({ sample_count: 2, comparisons: [] }));
  const comparisons = sections[1];
  assert.deepEqual(comparisons.items, []);
  assert.notEqual(comparisons.notice, null);
});

test('challenge.ai-report: 근거 구간은 그 자리부터 다시 볼 수 있게 시각을 준다', () => {
  const evidence = { start_ms: 41_000, end_ms: 45_500 };

  assert.equal(evidenceStartSeconds(evidence), 41);
  assert.equal(evidenceLabel(evidence), '0:41–0:46');
  assert.equal(evidenceStartSeconds({ start_ms: -5 }), 0);
});

test('challenge.ai-report: 상태마다 다른 문구를 보이고 실패 뒤에만 다시 시도가 뜬다', () => {
  assert.notEqual(statusMessage('pending'), statusMessage('ready'));
  assert.notEqual(statusMessage('failed'), statusMessage('ready'));
  // 아직 만든 적이 없거나 실패했을 때만 요청 버튼이 뜬다.
  assert.equal(canRequest(null), true);
  assert.equal(canRequest(report({ status: 'failed' })), true);
  assert.equal(canRequest(report({ status: 'pending' })), false);
  assert.equal(canRequest(report()), false);
});

test('challenge.ai-report: 하루 세 번이고 다시 시도도 한 번을 쓴다고 알린다', () => {
  assert.equal(AI_REPORT_DAILY_LIMIT, 3);
  assert.match(requestNotice(null), /세 번/);
  assert.match(requestNotice(report({ status: 'failed' })), /새로 만들어요/);
});

test('challenge.ai-report: 하루 한도·파기된 영상·남의 리포트를 갈라 본다', () => {
  assert.deepEqual(reportRequestFailure(apiError(429, 'daily_report_request_limit')), { kind: 'daily_limit' });
  assert.deepEqual(reportRequestFailure(apiError(422, 'video_not_ready')), { kind: 'video_not_ready' });
  assert.deepEqual(reportRequestFailure(apiError(404)), { kind: 'not_found' });
  assert.deepEqual(reportRequestFailure(Object.assign(new Error('x'), { name: 'NetworkError' })), { kind: 'offline' });
});
