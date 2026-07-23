import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_CREDENTIAL_KEY,
  createAuthCredentialStore,
} from '../lib/auth-credentials.ts';

const credentialMutationModule =
  await import('../lib/credential-mutation-queue.ts').catch(() => null);

function jwtWithSubject(subject) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject })}.signature`;
}

function createDelayedStorage() {
  const values = new Map();
  let nextWriteBlock = null;

  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      const block = nextWriteBlock;
      if (block) {
        nextWriteBlock = null;
        block.markStarted();
        await block.wait;
      }
      values.set(key, value);
    },
    async deleteItem(key) {
      values.delete(key);
    },
    blockNextWrite() {
      let markStarted;
      let release;
      const started = new Promise((resolve) => {
        markStarted = resolve;
      });
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      nextWriteBlock = { markStarted, wait };
      return { started, release };
    },
    values,
  };
}

function createQueue(storage) {
  assert.ok(
    credentialMutationModule?.createCredentialMutationQueue,
    'credential mutation queue factory가 있어야 합니다.',
  );
  return credentialMutationModule.createCredentialMutationQueue(
    createAuthCredentialStore(storage),
  );
}

const userA = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  status: 'active',
};
const userB = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'b@example.com',
  status: 'active',
};

test('R1: principal 교정 commit은 token과 user 공개 전에 epoch을 올린다', async () => {
  const storage = createDelayedStorage();
  const queue = createQueue(storage);
  await queue.setLoginTokens(jwtWithSubject(userA.id), 'refresh-a', userA);
  const expectedEpoch = queue.getAuthSessionEpoch();
  let listenerSnapshot = null;
  queue.onStoredUserChanged((user) => {
    listenerSnapshot = {
      epoch: queue.getAuthSessionEpoch(),
      accessToken: queue.getAccessToken(),
      user,
    };
  });

  assert.equal(
    await queue.commitRefresh(
      jwtWithSubject(userB.id),
      'refresh-b',
      {
        authSessionEpoch: expectedEpoch,
        refreshToken: 'refresh-a',
      },
    ),
    'principal_changed',
  );

  assert.equal(queue.getAuthSessionEpoch(), expectedEpoch + 1);
  assert.deepEqual(listenerSnapshot, {
    epoch: expectedEpoch + 1,
    accessToken: jwtWithSubject(userB.id),
    user: {
      id: userB.id,
      email: null,
      status: 'active',
    },
  });
});

test('R2: 지연된 refresh 저장보다 늦게 요청한 clear가 credential 부활을 막는다', async () => {
  const storage = createDelayedStorage();
  const queue = createQueue(storage);
  await queue.setLoginTokens(jwtWithSubject(userA.id), 'refresh-a', userA);
  const expectedEpoch = queue.getAuthSessionEpoch();
  const blockedWrite = storage.blockNextWrite();

  const refreshCommit = queue.commitRefresh(
    jwtWithSubject(userA.id),
    'refresh-a-rotated',
    {
      authSessionEpoch: expectedEpoch,
      refreshToken: 'refresh-a',
    },
  );
  await blockedWrite.started;
  const clearCommit = queue.clearTokens();

  assert.equal(queue.getAccessToken(), null);
  assert.equal(queue.getRefreshToken(), null);
  blockedWrite.release();

  assert.equal(await refreshCommit, 'stale');
  await clearCommit;
  assert.equal(queue.getAccessToken(), null);
  assert.equal(queue.getRefreshToken(), null);
  assert.equal(queue.getStoredUser(), null);
  assert.equal(storage.values.has(AUTH_CREDENTIAL_KEY), false);
});

test('R2: 지연된 refresh 저장보다 늦게 요청한 login이 최종 memory와 storage를 차지한다', async () => {
  const storage = createDelayedStorage();
  const queue = createQueue(storage);
  await queue.setLoginTokens(jwtWithSubject(userA.id), 'refresh-a', userA);
  const expectedEpoch = queue.getAuthSessionEpoch();
  const blockedWrite = storage.blockNextWrite();

  const refreshCommit = queue.commitRefresh(
    jwtWithSubject(userA.id),
    'refresh-a-rotated',
    {
      authSessionEpoch: expectedEpoch,
      refreshToken: 'refresh-a',
    },
  );
  await blockedWrite.started;
  const loginCommit = queue.setLoginTokens(
    jwtWithSubject(userB.id),
    'refresh-b',
    userB,
  );

  assert.equal(queue.getAccessToken(), null);
  assert.equal(queue.getRefreshToken(), null);
  blockedWrite.release();

  assert.equal(await refreshCommit, 'stale');
  assert.equal(await loginCommit, true);
  assert.equal(queue.getAccessToken(), jwtWithSubject(userB.id));
  assert.equal(queue.getRefreshToken(), 'refresh-b');
  assert.deepEqual(queue.getStoredUser(), userB);
  const persisted = JSON.parse(storage.values.get(AUTH_CREDENTIAL_KEY));
  assert.equal(persisted.accessToken, jwtWithSubject(userB.id));
  assert.equal(persisted.refreshToken, 'refresh-b');
  assert.deepEqual(persisted.user, userB);
});
