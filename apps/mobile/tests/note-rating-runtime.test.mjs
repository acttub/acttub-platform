import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/stub-modules.mjs';

const state = { storage: memoryStorage(), sent: [], fail: null };
globalThis.__noteRating = state;
stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__noteRating.storage;',
  '@/lib/api': `const s = globalThis.__noteRating;
    export const api = { putNoteRating: async (id, body) => { if (s.fail) throw s.fail; s.sent.push([id, body]); } };`,
});
const { flushNoteRatings, noteRatings } = await import('../lib/note-rating.ts');

test('못 보낸 노트 평가를 남겨 두었다가 같은 요청 id 로 다시 보낸다', async () => {
  state.fail = new TypeError('offline');
  assert.equal(await noteRatings.send('p1', { request_id: 'r1', rating: 'helpful' }), 'queued');

  state.fail = null;
  await flushNoteRatings();
  assert.deepEqual(state.sent, [['p1', { request_id: 'r1', rating: 'helpful' }]]);
});

test('다시 보내기의 실패는 던지지 않는다', async () => {
  state.storage.getItem = async () => { throw new Error('io'); };
  await flushNoteRatings();
});
