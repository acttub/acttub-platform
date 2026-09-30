import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VIDEO_DURATION_MS,
  sceneValueForSubmit,
  normalizeVideoDurationMs,
} from '../lib/upload-input.ts';

test('영상 길이를 길이 검사와 요청에 쓸 동일한 정수 millisecond로 정규화한다', () => {
  assert.equal(normalizeVideoDurationMs(12345.678), 12346);
  assert.equal(normalizeVideoDurationMs(12345.0), 12345);
  assert.equal(normalizeVideoDurationMs(null), null);
  assert.equal(normalizeVideoDurationMs(Number.NaN), null);
  assert.equal(normalizeVideoDurationMs(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeVideoDurationMs(0), null);
  assert.equal(MAX_VIDEO_DURATION_MS, 300_000);
});

test('빈 장면 칸과 공백만 있는 칸은 자리표시자 없이 빈 문자열로 제출한다 (ADR-021)', () => {
  assert.equal(sceneValueForSubmit(''), '');
  assert.equal(sceneValueForSubmit('   '), '');
  assert.equal(sceneValueForSubmit('  카페에서  '), '카페에서');
});
