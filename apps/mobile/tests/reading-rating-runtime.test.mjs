import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

const state = { storage: memoryStorage(), sent: [], fail: null };
globalThis.__readingRating = state;
stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__readingRating.storage;',
  '@/lib/api': `const s = globalThis.__readingRating;
    export const api = { putReadingSessionRating: async (id, body) => { if (s.fail) throw s.fail; s.sent.push([id, body]); } };`,
});
const { flushReadingRatings, readingRatings } = await import('../lib/reading-rating.ts');

test('못 보낸 리딩 회차 평가를 다시 보낸다', async () => {
  state.fail = new TypeError('offline');
  assert.equal(await readingRatings.send('s1', { request_id: 'r1', rating: 'good' }), 'queued');
  assert.deepEqual(JSON.parse(state.storage.values.get('acttub.readingRating.pending')), [{ practice_id: 's1', body: { request_id: 'r1', rating: 'good' } }]);

  state.fail = null;
  await flushReadingRatings();
  assert.deepEqual(state.sent, [['s1', { request_id: 'r1', rating: 'good' }]]);
});

test('다시 보내기의 실패는 던지지 않는다', async () => {
  state.storage.getItem = async () => { throw new Error('io'); };
  await flushReadingRatings();
});
