import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

stubModules({});
const { seedPractice, seedPreviewAnalyzing } = await import('../lib/ui-preview.ts');
const { getPractice } = await import('../lib/practice/session-state.ts');

test('미리보기 회차를 분석까지 지난 상태로 채운다', () => {
  seedPractice();
  assert.equal(getPractice().practiceId, 'preview-practice');
  assert.equal(getPractice().conversationId, 'preview-conversation');
  assert.equal(getPractice().note, null);
});

test('분석 화면 미리보기는 분석 중인 회차를 돌려준다', () => {
  const { detail } = seedPreviewAnalyzing();
  assert.equal(detail.stage, 'analyzing');
  assert.equal(detail.job.status, 'running');
  assert.equal(Number.isNaN(Date.parse(detail.created_at)), false);
});
