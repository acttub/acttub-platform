import assert from 'node:assert/strict';
import test from 'node:test';

import { createCredentialMutationQueue } from '../lib/credential-mutation-queue.ts';

const userA = { id: 'user-a', email: 'a@test.dev', status: 'active' };
const record = (accessToken, refreshToken, user = userA) => ({ schemaVersion: 1, accessToken, refreshToken, user });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 저장소 대역. 각 동작을 기록하고, 시험이 원하면 한 번 멈춰 세운다. */
function persistence({ stored = null } = {}) {
  const log = [];
  const gates = {};
  const gated = async (name, value) => {
    const gate = gates[name];
    if (gate) {
      delete gates[name];
      gate.started.resolve();
      await gate.release.promise;
    }
    return value();
  };
  return {
    log,
    hold(name) {
      const gate = { started: deferred(), release: deferred() };
      gates[name] = gate;
      return { started: gate.started.promise, release: () => gate.release.resolve() };
    },
    impl: {
      load: () => gated('load', () => {
        log.push(['load']);
        if (stored instanceof Error) throw stored;
        return stored;
      }),
      save: (access, refresh, user) => gated('save', () => {
        log.push(['save', access, refresh]);
        return record(access, refresh, user);
      }),
      saveRefreshed: (access, refresh, user) => gated('saveRefreshed', () => {
        log.push(['saveRefreshed', access, refresh]);
        return record(access, refresh, user);
      }),
      clear: () => gated('clear', () => {
        log.push(['clear']);
        if (stored instanceof Error) throw stored;
      }),
    },
  };
}

test('저장소 읽기가 실패해도 로그인 전 상태로 준비를 끝낸다', async () => {
  const store = persistence({ stored: new Error('keychain unavailable') });
  const queue = createCredentialMutationQueue(store.impl);
  assert.equal(await queue.loadTokens(), false);
  await queue.waitForCredentialReady();
  assert.equal(queue.getAccessToken(), null);
});

test('한 번 읽은 뒤의 loadTokens 는 저장소를 다시 읽지 않는다', async () => {
  const store = persistence({ stored: record('access-a', 'refresh-a') });
  const queue = createCredentialMutationQueue(store.impl);
  const [first, second] = await Promise.all([queue.loadTokens(), queue.loadTokens()]);
  assert.deepEqual([first, second, await queue.loadTokens()], [true, true, true]);
  assert.deepEqual(store.log, [['load']]);
  assert.equal(queue.getRefreshToken(), 'refresh-a');
  assert.deepEqual(queue.getStoredUser(), userA);
});

test('저장소를 읽는 동안 로그인하면 읽은 옛 값을 버리고 로그인 값이 남는다', async () => {
  const store = persistence({ stored: record('access-old', 'refresh-old') });
  const queue = createCredentialMutationQueue(store.impl);
  const load = store.hold('load');
  const loading = queue.loadTokens();
  await load.started;
  const login = queue.setLoginTokens('access-new', 'refresh-new', userA);
  load.release();
  assert.equal(await loading, false);
  assert.equal(await login, true);
  await queue.waitForCredentialReady();
  assert.equal(queue.getAccessToken(), 'access-new');
});

test('연달아 로그인하면 앞선 로그인은 저장소에 쓰지 않고 false', async () => {
  const store = persistence();
  const queue = createCredentialMutationQueue(store.impl);
  const first = queue.setLoginTokens('access-1', 'refresh-1', userA);
  const second = queue.setLoginTokens('access-2', 'refresh-2', userA);
  assert.deepEqual([await first, await second], [false, true]);
  assert.deepEqual(store.log, [['save', 'access-2', 'refresh-2']]);
  assert.equal(queue.getRefreshToken(), 'refresh-2');
});

test('로그인 저장 중에 로그아웃을 누르면 저장한 것을 지우고 로그인은 false', async () => {
  const store = persistence();
  const queue = createCredentialMutationQueue(store.impl);
  let cleared = 0;
  queue.onTokensCleared(() => {
    cleared += 1;
  });
  const save = store.hold('save');
  const login = queue.setLoginTokens('access-1', 'refresh-1', userA);
  await save.started;
  const logout = queue.clearTokens();
  save.release();
  assert.deepEqual([await login, await logout], [false, true]);
  assert.deepEqual(store.log, [['save', 'access-1', 'refresh-1'], ['clear'], ['clear']]);
  assert.equal(queue.getAccessToken(), null);
  assert.equal(cleared, 1);
});

test('같은 사람의 토큰 갱신은 refreshed 이고 세션 경계는 그대로다', async () => {
  const store = persistence({ stored: record('access-a', 'refresh-a') });
  const queue = createCredentialMutationQueue(store.impl);
  await queue.loadTokens();
  const epoch = queue.getAuthSessionEpoch();
  assert.equal(await queue.commitRefresh('access-a2', 'refresh-a2', { authSessionEpoch: epoch, refreshToken: 'refresh-a' }), 'refreshed');
  assert.equal(queue.getAccessToken(), 'access-a2');
  assert.equal(queue.getAuthSessionEpoch(), epoch);
});

test('지워진 세션에는 갱신 결과를 저장하지 않는다', async () => {
  const store = persistence();
  const queue = createCredentialMutationQueue(store.impl);
  await queue.loadTokens();
  const result = await queue.commitRefresh('access-x', 'refresh-x', { authSessionEpoch: queue.getAuthSessionEpoch(), refreshToken: null });
  assert.equal(result, 'stale');
  assert.deepEqual(store.log, [['load']]);
  assert.equal(queue.getAccessToken(), null);
});

test('갱신 결과를 저장하는 사이 로그아웃하면 저장한 것을 지우고 stale', async () => {
  const store = persistence({ stored: record('access-a', 'refresh-a') });
  const queue = createCredentialMutationQueue(store.impl);
  await queue.loadTokens();
  const saving = store.hold('saveRefreshed');
  const commit = queue.commitRefresh('access-a2', 'refresh-a2', { authSessionEpoch: queue.getAuthSessionEpoch(), refreshToken: 'refresh-a' });
  await saving.started;
  const logout = queue.clearTokens();
  saving.release();
  assert.deepEqual([await commit, await logout], ['stale', true]);
  assert.deepEqual(store.log.slice(1), [['saveRefreshed', 'access-a2', 'refresh-a2'], ['clear'], ['clear']]);
  assert.equal(queue.getRefreshToken(), null);
});

test('저장소 삭제가 실패해도 로그아웃은 메모리 세션을 비우고 알린다', async () => {
  const store = persistence({ stored: new Error('keychain locked') });
  const queue = createCredentialMutationQueue(store.impl);
  let cleared = 0;
  const unsubscribe = queue.onTokensCleared(() => {
    cleared += 1;
  });
  assert.equal(await queue.clearTokens(), true);
  assert.equal(queue.getAccessToken(), null);
  assert.equal(cleared, 1);
  unsubscribe();
  await queue.clearTokens();
  assert.equal(cleared, 1, '구독을 끊으면 더 알리지 않는다');
});

test('clearTokensIfCurrent: 아직 읽기 전이면 지우지 않고, 기대한 세션이면 지운다', async () => {
  const store = persistence({ stored: record('access-a', 'refresh-a') });
  const queue = createCredentialMutationQueue(store.impl);
  assert.equal(await queue.clearTokensIfCurrent({ authSessionEpoch: 0, refreshToken: null }), false);
  assert.deepEqual(store.log, []);
  await queue.loadTokens();
  assert.equal(await queue.clearTokensIfCurrent({ authSessionEpoch: 0, refreshToken: 'refresh-a' }), true);
  assert.equal(queue.getRefreshToken(), null);
  assert.equal(queue.getAuthSessionEpoch(), 1);
});

test('지나간 refresh 토큰으로 온 갱신 결과는 저장소에 닿지 않고 stale', async () => {
  const store = persistence({ stored: record('access-a', 'refresh-a') });
  const queue = createCredentialMutationQueue(store.impl);
  await queue.loadTokens();
  const result = await queue.commitRefresh('access-x', 'refresh-x', { authSessionEpoch: queue.getAuthSessionEpoch(), refreshToken: 'refresh-old' });
  assert.equal(result, 'stale');
  assert.deepEqual(store.log, [['load']]);
  assert.equal(queue.getRefreshToken(), 'refresh-a');
});

test('로그아웃을 연달아 누르면 마지막 것만 세션을 비웠다고 알린다', async () => {
  const store = persistence();
  const queue = createCredentialMutationQueue(store.impl);
  let cleared = 0;
  queue.onTokensCleared(() => {
    cleared += 1;
  });
  const results = await Promise.all([queue.clearTokens(), queue.clearTokens()]);
  assert.deepEqual(results, [false, true]);
  assert.equal(cleared, 1);
});

test('로그인 저장이 실패하면 그 호출만 실패하고 뒤 작업은 이어서 돈다', async () => {
  const store = persistence();
  const failure = new Error('keychain write failed');
  const queue = createCredentialMutationQueue({ ...store.impl, save: async () => { throw failure; } });
  await assert.rejects(queue.setLoginTokens('access-1', 'refresh-1', userA), failure);
  assert.equal(queue.getAccessToken(), null);
  assert.equal(await queue.clearTokens(), true);
  assert.deepEqual(store.log, [['clear']]);
});
