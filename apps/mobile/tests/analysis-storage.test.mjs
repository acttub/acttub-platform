import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

globalThis.__analysisStorage = memoryStorage();
stubModules({ '@react-native-async-storage/async-storage': 'export default globalThis.__analysisStorage;' });
const { pendingAnalysisStore } = await import('../lib/analysis-storage.ts');

test('기다리던 분석을 기기에 적었다가 그 계정으로 다시 찾는다', async () => {
  const record = { schemaVersion: 2, owner: 'u1', practice_id: 'p1' };
  const handle = await pendingAnalysisStore.save(record, 'upload');
  assert.deepEqual((await pendingAnalysisStore.loadForOwner('u1')).record, record);
  assert.equal(await pendingAnalysisStore.loadForOwner('u2'), null);

  await pendingAnalysisStore.remove(handle);
  assert.equal(await pendingAnalysisStore.loadForOwner('u1'), null);
});
