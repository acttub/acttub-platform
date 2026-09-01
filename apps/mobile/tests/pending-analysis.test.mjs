import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYSIS_SCHEMA_VERSION,
  createPendingAnalysisStore,
} from '../lib/pending-analysis.ts';

function createMemoryStorage() {
  const values = new Map();
  return {
    async getAllKeys() {
      return [...values.keys()];
    },
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function record(owner, sessionId) {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    owner,
    session_id: sessionId,
  };
}

test('E3: 이전 generation의 늦은 remove가 새 pending record를 지우지 않는다', async () => {
  const storage = createMemoryStorage();
  const store = createPendingAnalysisStore(storage);
  const oldHandle = await store.save(record('user-1', 'session-old'), '100-instance-1');
  const newHandle = await store.save(record('user-1', 'session-new'), '200-instance-2');

  await store.remove(oldHandle);

  assert.equal(storage.values.has(oldHandle.key), false);
  assert.equal(storage.values.has(newHandle.key), true);
  assert.deepEqual(await store.loadForOwner('user-1'), newHandle);
});

test('Q3: B principal 교정 뒤에도 A pending record가 남아 A 재로그인 시 복구된다', async () => {
  const storage = createMemoryStorage();
  const store = createPendingAnalysisStore(storage);
  const ownerA = await store.save(record('user-a', 'session-a'), '100-a');
  const invalidSchema = await store.save(
    { schemaVersion: 999, owner: 'user-b', session_id: 'session-invalid' },
    '200-invalid',
  );
  const ownerB = await store.save(record('user-b', 'session-b'), '300-b');

  assert.deepEqual(await store.loadForOwner('user-b'), ownerB);
  assert.equal(storage.values.has(ownerA.key), true);
  assert.equal(storage.values.has(invalidSchema.key), false);
  assert.equal(storage.values.has(ownerB.key), true);

  assert.deepEqual(await store.loadForOwner('user-a'), ownerA);
  assert.equal(storage.values.has(ownerA.key), true);
  assert.equal(storage.values.has(ownerB.key), true);
});

test('M5: 같은 owner의 복수 record에서는 최신 generation만 복구한다', async () => {
  const storage = createMemoryStorage();
  const store = createPendingAnalysisStore(storage);
  const older = await store.save(record('user-1', 'session-z'), '100-instance-1');
  const newer = await store.save(record('user-1', 'session-a'), '200-instance-2');

  assert.deepEqual(await store.loadForOwner('user-1'), newer);
  assert.equal(storage.values.has(older.key), false);
  assert.equal(storage.values.has(newer.key), true);
});
