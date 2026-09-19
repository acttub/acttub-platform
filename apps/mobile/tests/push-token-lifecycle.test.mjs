import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushTokenLifecycle } from '../lib/push-token-lifecycle.ts';

function memoryStorage() {
  const items = new Map();
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  };
}

/** 서버 흉내. online=false면 비행기 모드처럼 모든 요청이 실패한다. */
function fakeServer() {
  const state = { online: true, tokens: new Map(), calls: [] };
  return {
    state,
    api: {
      register: async (token, platform, owner = 'current') => {
        state.calls.push(`POST ${token}`);
        if (!state.online) throw new TypeError('offline');
        state.tokens.set(token, owner);
        void platform;
      },
      unregister: async (token) => {
        state.calls.push(`DELETE ${token}`);
        if (!state.online) throw new TypeError('offline');
        state.tokens.delete(token);
      },
    },
  };
}

test('account.logout: 로그아웃의 첫 단계는 이 폰의 푸시 토큰을 서버에서 지우는 것이다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');
  assert.equal(server.state.tokens.has('T1'), true);

  await lifecycle.detach();

  assert.equal(server.state.tokens.has('T1'), false);
  assert.equal(await lifecycle.currentToken(), null);
  assert.deepEqual(await lifecycle.pendingDeletions(), []);
});

test('account.logout: 비행기 모드에서 로그아웃하면 지우지 못한 토큰을 기기에 적어 두고, 네트워크가 돌아온 뒤 앱을 열면 서버에 그 폰의 토큰이 없다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');

  server.state.online = false;
  await lifecycle.detach(); // 실패해도 던지지 않는다 — 로그아웃은 계속 간다.

  assert.equal(await lifecycle.currentToken(), null);
  assert.deepEqual(await lifecycle.pendingDeletions(), ['T1']);
  assert.equal(server.state.tokens.has('T1'), true);

  // 다음 실행. 같은 저장소로 새로 만든다 — 로그인 없이 다시 보낸다.
  server.state.online = true;
  const nextLaunch = createPushTokenLifecycle({ storage, api: server.api });
  await nextLaunch.flushPending();

  assert.equal(server.state.tokens.has('T1'), false);
  assert.deepEqual(await nextLaunch.pendingDeletions(), []);
});

test('account.notification: 다음 실행의 재시도도 실패하면 밀린 삭제를 그대로 두고 그다음 실행에 다시 보낸다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'android');
  server.state.online = false;
  await lifecycle.detach();

  await lifecycle.flushPending();
  assert.deepEqual(await lifecycle.pendingDeletions(), ['T1']);

  server.state.online = true;
  await lifecycle.flushPending();
  assert.deepEqual(await lifecycle.pendingDeletions(), []);
});

test('account.notification: 새 로그인으로 등록에 성공하면 밀린 삭제를 버려 새 회원의 등록을 지우지 않는다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');
  server.state.online = false;
  await lifecycle.detach();
  server.state.online = true;

  // 다음 사람이 이 폰으로 로그인해 게이트를 통과했다. 같은 폰이라 토큰도 같다.
  await lifecycle.register('T1', 'ios');
  assert.deepEqual(await lifecycle.pendingDeletions(), []);

  await lifecycle.flushPending();
  assert.equal(server.state.tokens.has('T1'), true, '밀린 삭제가 새 등록을 지웠다');
  assert.equal(server.state.calls.filter((call) => call === 'DELETE T1').length, 1);
});

test('account.notification: 등록에 실패하면 밀린 삭제는 남아 옛 계정의 토큰을 계속 지우려 한다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');
  server.state.online = false;
  await lifecycle.detach();

  await assert.rejects(lifecycle.register('T1', 'ios'));

  assert.deepEqual(await lifecycle.pendingDeletions(), ['T1']);
  assert.equal(await lifecycle.currentToken(), null);
});

test('account.notification: 앱을 열 때의 재시도와 새 등록이 겹쳐도 삭제가 등록 뒤에 도착하지 않는다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');
  server.state.online = false;
  await lifecycle.detach();
  server.state.online = true;
  server.state.calls.length = 0;

  // 앱을 열자마자 재시도가 시작되고, 끝나기 전에 로그인·게이트 통과로 등록이 불린다.
  const flushing = lifecycle.flushPending();
  const registering = lifecycle.register('T1', 'ios');
  await Promise.all([flushing, registering]);

  assert.deepEqual(server.state.calls, ['DELETE T1', 'POST T1']);
  assert.equal(server.state.tokens.has('T1'), true);
});

test('account.notification: 푸시 토글 둘을 다 꺼 서버가 토큰을 지웠으면 앱은 기록만 버리고 삭제를 또 보내지 않는다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');
  server.state.calls.length = 0;

  await lifecycle.forget();

  assert.equal(await lifecycle.currentToken(), null);
  assert.deepEqual(server.state.calls, []);
  assert.deepEqual(await lifecycle.pendingDeletions(), []);
});

test('account.logout: 밀린 삭제는 계정 자료를 쓸어 내는 acttub. 접두사 밖에 적어 로그아웃 뒤에도 남는다', async () => {
  const storage = memoryStorage();
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });
  await lifecycle.register('T1', 'ios');
  server.state.online = false;
  await lifecycle.detach();

  const pendingKeys = [...storage.items.keys()].filter((key) => storage.items.get(key)?.includes('T1'));
  assert.equal(pendingKeys.length, 1);
  assert.equal(pendingKeys[0].startsWith('acttub.'), false);
});

test('account.notification: 저장소가 깨져 있어도 로그아웃과 재시도는 던지지 않는다', async () => {
  const storage = memoryStorage();
  storage.items.set('device.pendingPushTokenDeletions', '깨진 값');
  const server = fakeServer();
  const lifecycle = createPushTokenLifecycle({ storage, api: server.api });

  await lifecycle.flushPending();
  await lifecycle.detach();
  assert.deepEqual(await lifecycle.pendingDeletions(), []);
});
