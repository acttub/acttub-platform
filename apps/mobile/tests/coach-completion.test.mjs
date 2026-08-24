import assert from 'node:assert/strict';
import test from 'node:test';

import { coachCompletionNext } from '../lib/coach-flow.ts';

// 코치가 대화를 끝냈을 때 화면이 어디로 가야 하는지 — 정리(report)가 안 실려 와도
// 배우가 갇히면 안 된다. 리포트 화면이 정리를 직접 만들어 준다.

test('대화가 계속이면 아무 데도 안 간다', () => {
  assert.equal(coachCompletionNext({ status: 'continue', report: null }), 'continue');
  assert.equal(
    coachCompletionNext({ status: 'continue', report: { report_type: 'coach' } }),
    'continue',
  );
});

test('정리가 함께 오면 리포트로 간다', () => {
  assert.equal(
    coachCompletionNext({ status: 'complete', report: { report_type: 'coach' } }),
    'report',
  );
});

test('끝났는데 정리가 안 와도 리포트로 간다 — 거기서 정리를 만든다', () => {
  assert.equal(coachCompletionNext({ status: 'complete', report: null }), 'report');
});

test('노트로 남기기엔 짧아 막힌 종료는 대화 화면에 남는다', () => {
  assert.equal(
    coachCompletionNext({ status: 'complete', report: { report_type: 'blocked' } }),
    'note-skipped',
  );
});
