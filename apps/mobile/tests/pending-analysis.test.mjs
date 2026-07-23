import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYSIS_SCHEMA_VERSION,
  createPendingAnalysisStore,
  decideBootstrapRoute,
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

test('E7: owner/schemaVersion 불일치 record를 폐기한다', async () => {
  const storage = createMemoryStorage();
  const store = createPendingAnalysisStore(storage);
  const otherOwner = await store.save(record('user-old', 'session-old'), '100-old');
  const invalidSchema = await store.save(
    { schemaVersion: 999, owner: 'user-new', session_id: 'session-invalid' },
    '200-invalid',
  );
  const current = await store.save(record('user-new', 'session-current'), '300-current');

  assert.deepEqual(await store.loadForOwner('user-new'), current);
  assert.equal(storage.values.has(otherOwner.key), false);
  assert.equal(storage.values.has(invalidSchema.key), false);
  assert.equal(storage.values.has(current.key), true);
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

test('M5: auth와 recovery가 모두 준비된 뒤 한 bootstrap owner가 최초 route를 결정한다', () => {
  const pending = {
    key: 'pending:user-1:session-1:scope',
    record: record('user-1', 'session-1'),
  };

  assert.equal(
    decideBootstrapRoute({
      authStatus: 'loading',
      hasPendingConsents: false,
      recoveryStatus: 'loading',
      pending: null,
    }),
    null,
  );
  assert.equal(
    decideBootstrapRoute({
      authStatus: 'signedIn',
      hasPendingConsents: false,
      recoveryStatus: 'loading',
      pending: null,
    }),
    null,
  );
  assert.deepEqual(
    decideBootstrapRoute({
      authStatus: 'signedIn',
      hasPendingConsents: false,
      recoveryStatus: 'ready',
      pending,
    }),
    {
      pathname: '/analyzing',
      params: {
        recoveryKey: pending.key,
        sessionId: 'session-1',
      },
    },
  );
  assert.equal(
    decideBootstrapRoute({
      authStatus: 'signedIn',
      hasPendingConsents: true,
      recoveryStatus: 'ready',
      pending,
    }),
    '/consent',
  );
  assert.equal(
    decideBootstrapRoute({
      authStatus: 'signedOut',
      hasPendingConsents: false,
      recoveryStatus: 'ready',
      pending: null,
    }),
    '/login',
  );
});
