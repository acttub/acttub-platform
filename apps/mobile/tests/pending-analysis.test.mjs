import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYSIS_SCHEMA_VERSION,
  createPendingAnalysisStore,
  decideBootstrapRoute,
} from '../lib/pending-analysis.ts';
import * as pendingAnalysisModule from '../lib/pending-analysis.ts';

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

test('F4: consent gate가 끝나면 같은 session의 pending recovery를 거쳐 analyzing으로 간다', () => {
  const resolveBootstrapStep = pendingAnalysisModule.resolveBootstrapStep;
  assert.ok(resolveBootstrapStep, '단계형 bootstrap state machine이 있어야 합니다.');
  const pending = {
    key: 'pending:user-1:session-1:scope',
    record: record('user-1', 'session-1'),
  };
  const base = {
    authStatus: 'signedIn',
    userId: 'user-1',
    recoveryStatus: 'ready',
    recoveryOwner: 'user-1',
    pending,
  };

  assert.deepEqual(
    resolveBootstrapStep({ ...base, hasPendingConsents: true }),
    {
      stage: 'consent-gate',
      route: '/consent',
    },
  );
  assert.deepEqual(
    resolveBootstrapStep({ ...base, hasPendingConsents: false }),
    {
      stage: 'done',
      route: {
        pathname: '/analyzing',
        params: {
          recoveryKey: pending.key,
          sessionId: 'session-1',
        },
      },
    },
  );
});

test('F4: signedOut 뒤 signedIn의 stale owner:null recovery는 완료하지 않고 현재 owner를 기다린다', () => {
  const resolveBootstrapStep = pendingAnalysisModule.resolveBootstrapStep;
  assert.ok(resolveBootstrapStep, '단계형 bootstrap state machine이 있어야 합니다.');
  const pending = {
    key: 'pending:user-1:session-1:scope',
    record: record('user-1', 'session-1'),
  };

  assert.deepEqual(
    resolveBootstrapStep({
      authStatus: 'signedOut',
      userId: null,
      hasPendingConsents: false,
      recoveryStatus: 'ready',
      recoveryOwner: null,
      pending: null,
    }),
    {
      stage: 'auth-gate',
      route: '/login',
    },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      authStatus: 'signedIn',
      userId: 'user-1',
      hasPendingConsents: false,
      recoveryStatus: 'ready',
      recoveryOwner: null,
      pending: null,
    }),
    {
      stage: 'pending-recovery',
      route: null,
    },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      authStatus: 'signedIn',
      userId: 'user-1',
      hasPendingConsents: false,
      recoveryStatus: 'ready',
      recoveryOwner: 'user-1',
      pending,
    }),
    {
      stage: 'done',
      route: {
        pathname: '/analyzing',
        params: {
          recoveryKey: pending.key,
          sessionId: 'session-1',
        },
      },
    },
  );
});

test('F4: consent 전환 뒤 stale recovery snapshot은 storage 재로드 전 tabs를 결정하지 않는다', () => {
  const recoveryStatusForConsentGate =
    pendingAnalysisModule.recoveryStatusForConsentGate;
  assert.ok(
    recoveryStatusForConsentGate,
    'consent 전환별 recovery freshness 판정이 있어야 합니다.',
  );
  const pending = {
    key: 'pending:user-1:session-1:scope',
    record: record('user-1', 'session-1'),
  };
  const staleStatus = recoveryStatusForConsentGate(
    { status: 'ready', consentGate: 1 },
    2,
  );

  assert.equal(staleStatus, 'loading');
  assert.deepEqual(
    pendingAnalysisModule.resolveBootstrapStep({
      authStatus: 'signedIn',
      userId: 'user-1',
      hasPendingConsents: false,
      recoveryStatus: staleStatus,
      recoveryOwner: 'user-1',
      pending: null,
    }),
    {
      stage: 'pending-recovery',
      route: null,
    },
  );
  assert.deepEqual(
    pendingAnalysisModule.resolveBootstrapStep({
      authStatus: 'signedIn',
      userId: 'user-1',
      hasPendingConsents: false,
      recoveryStatus: recoveryStatusForConsentGate(
        { status: 'ready', consentGate: 2 },
        2,
      ),
      recoveryOwner: 'user-1',
      pending,
    }),
    {
      stage: 'done',
      route: {
        pathname: '/analyzing',
        params: {
          recoveryKey: pending.key,
          sessionId: 'session-1',
        },
      },
    },
  );
});

test('N2: analyzing recovery params가 목적 route와 같을 때만 bootstrap을 완료한다', () => {
  const resolveAnalyzingBootstrapRoute =
    pendingAnalysisModule.resolveAnalyzingBootstrapRoute;
  assert.ok(
    resolveAnalyzingBootstrapRoute,
    'analyzing pathname과 recovery params를 함께 판정해야 합니다.',
  );
  const target = {
    pathname: '/analyzing',
    params: {
      recoveryKey: 'pending:user-1:session-1:scope',
      sessionId: 'session-1',
    },
  };

  assert.equal(
    resolveAnalyzingBootstrapRoute('/analyzing', {}, target),
    'replace',
  );
  assert.equal(
    resolveAnalyzingBootstrapRoute(
      '/analyzing',
      { recoveryKey: 'pending:stale', sessionId: 'session-old' },
      target,
    ),
    'replace',
  );
  assert.equal(
    resolveAnalyzingBootstrapRoute(
      '/upload',
      target.params,
      target,
    ),
    'replace',
  );
  assert.equal(
    resolveAnalyzingBootstrapRoute(
      '/analyzing',
      target.params,
      target,
    ),
    'complete',
  );
});
