import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

const state = { storage: memoryStorage(), sent: [], fail: null };
globalThis.__exitReview = state;
stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__exitReview.storage;',
  '@/lib/api': `const s = globalThis.__exitReview;
    export const api = { submitPracticeFeedback: async body => { if (s.fail) throw s.fail; s.sent.push(body); } };`,
});
const { flushPracticeFeedback } = await import('../lib/exit-review.ts');

test('오프라인에서 밀린 이탈 설문 접수를 서버로 보내고 비운다', async () => {
  state.storage.values.set('acttub.feedback.pending', JSON.stringify([{ request_id: 'r1', reason: 'busy' }]));
  await flushPracticeFeedback();
  assert.deepEqual(state.sent, [{ request_id: 'r1', reason: 'busy' }]);
  assert.equal(state.storage.values.has('acttub.feedback.pending'), false);
});

test('보내기가 실패해도 던지지 않고 남겨 둔다', async () => {
  state.fail = new TypeError('offline');
  state.storage.values.set('acttub.feedback.pending', JSON.stringify([{ request_id: 'r2' }]));
  await flushPracticeFeedback();
  assert.deepEqual(JSON.parse(state.storage.values.get('acttub.feedback.pending')), [{ request_id: 'r2' }]);

  state.storage.getItem = async () => { throw new Error('io'); };
  await flushPracticeFeedback();
});
