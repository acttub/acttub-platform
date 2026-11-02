import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleWithin } from '../lib/reading/turn-close.ts';

test('reading.turn-close: 제때 끝나면 그 값을 쓴다', async () => {
  assert.equal(await settleWithin(Promise.resolve('대사'), 50, ''), '대사');
});

test('reading.turn-close: 늦거나 실패해도 정한 시간 뒤 fallback 으로 끝난다', async () => {
  assert.equal(await settleWithin(new Promise(() => {}), 20, ''), '');
  assert.equal(await settleWithin(Promise.reject(new Error('stt')), 50, ''), '');
});
