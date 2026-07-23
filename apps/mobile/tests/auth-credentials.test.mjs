import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, createApiRequestClient } from '../lib/api-request.ts';

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async deleteItem(key) {
      values.delete(key);
    },
    values,
  };
}

function jwtWithSubject(subject) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject })}.signature`;
}

async function loadCredentialModule() {
  return import('../lib/auth-credentials.ts').catch(() => null);
}

test('F3: legacy token-only record는 access JWT sub로 user를 hydrate해 versioned credential로 이관한다', async () => {
  const credentials = await loadCredentialModule();
  assert.ok(credentials, 'versioned credential store 모듈이 있어야 합니다.');
  const userId = '8f74bd95-43cf-4dde-90f2-6320722e5ae1';
  const storage = createMemoryStorage({
    [credentials.LEGACY_ACCESS_KEY]: jwtWithSubject(userId),
    [credentials.LEGACY_REFRESH_KEY]: 'refresh-token',
  });
  const store = credentials.createAuthCredentialStore(storage);

  const restored = await store.load();

  assert.deepEqual(restored?.user, {
    id: userId,
    email: null,
    status: 'active',
  });
  assert.equal(restored?.schemaVersion, credentials.AUTH_CREDENTIAL_SCHEMA_VERSION);
  const persisted = JSON.parse(storage.values.get(credentials.AUTH_CREDENTIAL_KEY));
  assert.deepEqual(persisted, restored);
  assert.equal(storage.values.has(credentials.LEGACY_ACCESS_KEY), false);
  assert.equal(storage.values.has(credentials.LEGACY_REFRESH_KEY), false);
});

test('F3: versioned credential은 access·refresh·user가 모두 없으면 복원하지 않고 정리한다', async () => {
  const credentials = await loadCredentialModule();
  assert.ok(credentials, 'versioned credential store 모듈이 있어야 합니다.');
  const storage = createMemoryStorage({
    [credentials.AUTH_CREDENTIAL_KEY]: JSON.stringify({
      schemaVersion: credentials.AUTH_CREDENTIAL_SCHEMA_VERSION,
      accessToken: jwtWithSubject('8f74bd95-43cf-4dde-90f2-6320722e5ae1'),
      refreshToken: 'refresh-token',
    }),
  });
  const store = credentials.createAuthCredentialStore(storage);

  assert.equal(await store.load(), null);
  assert.equal(storage.values.size, 0);
});

test('F3: token-only record의 JWT에서 sub를 꺼낼 수 없으면 토큰을 지우고 재로그인을 요구한다', async () => {
  const credentials = await loadCredentialModule();
  assert.ok(credentials, 'versioned credential store 모듈이 있어야 합니다.');
  const storage = createMemoryStorage({
    [credentials.LEGACY_ACCESS_KEY]: 'not-a-jwt',
    [credentials.LEGACY_REFRESH_KEY]: 'refresh-token',
  });
  const store = credentials.createAuthCredentialStore(storage);

  assert.equal(await store.load(), null);
  assert.equal(storage.values.size, 0);
});

test('F3: React Native처럼 atob가 없어도 JWT sub를 파싱해 credential을 저장한다', async () => {
  const credentials = await loadCredentialModule();
  assert.ok(credentials, 'versioned credential store 모듈이 있어야 합니다.');
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'atob');
  Object.defineProperty(globalThis, 'atob', {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    const userId = '8f74bd95-43cf-4dde-90f2-6320722e5ae1';
    const accessToken = jwtWithSubject(userId);
    assert.equal(credentials.readJwtSubject(accessToken), userId);

    const storage = createMemoryStorage();
    const store = credentials.createAuthCredentialStore(storage);
    const saved = await store.save(accessToken, 'refresh-token', {
      id: userId,
      email: null,
      status: 'active',
    });
    assert.equal(saved.user.id, userId);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'atob', originalDescriptor);
    } else {
      delete globalThis.atob;
    }
  }
});

test('N1: 파싱 가능한 잘못된 legacy sub도 refresh 회전 후 새 principal과 토큰을 저장한다', async () => {
  const credentials = await loadCredentialModule();
  assert.ok(credentials, 'versioned credential store 모듈이 있어야 합니다.');
  const wrongUserId = '11111111-1111-4111-8111-111111111111';
  const actualUserId = '8f74bd95-43cf-4dde-90f2-6320722e5ae1';
  const storage = createMemoryStorage({
    [credentials.LEGACY_ACCESS_KEY]: jwtWithSubject(wrongUserId),
    [credentials.LEGACY_REFRESH_KEY]: 'refresh-old',
  });
  const store = credentials.createAuthCredentialStore(storage);
  const restored = await store.load();
  assert.equal(restored?.user.id, wrongUserId);

  let accessToken = restored.accessToken;
  let refreshToken = restored.refreshToken;
  let user = restored.user;
  let protectedCalls = 0;
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === '/v2/auth/refresh') {
        return new Response(JSON.stringify({
          access_token: jwtWithSubject(actualUserId),
          refresh_token: 'refresh-new',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      protectedCalls += 1;
      return protectedCalls === 1
        ? new Response(JSON.stringify({ detail: 'expired access' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
    },
    waitForCredentialReady: async () => {},
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    getAuthSessionEpoch: () => 0,
    setTokens: async (nextAccessToken, nextRefreshToken) => {
      const previousUserId = user.id;
      const saved = await store.saveRefreshed(nextAccessToken, nextRefreshToken, user);
      accessToken = saved.accessToken;
      refreshToken = saved.refreshToken;
      user = saved.user;
      return saved.user.id === previousUserId ? 'refreshed' : 'principal_changed';
    },
    clearTokens: async () => {
      await store.clear();
      return true;
    },
    emitConsentRequired: () => {},
  });

  await assert.rejects(
    client.request('/v2/protected'),
    (error) => error instanceof ApiError && error.code === 'session_changed',
  );
  assert.equal(protectedCalls, 1);
  assert.equal(accessToken, jwtWithSubject(actualUserId));
  assert.equal(refreshToken, 'refresh-new');
  assert.deepEqual(user, {
    id: actualUserId,
    email: null,
    status: 'active',
  });
  const persisted = JSON.parse(storage.values.get(credentials.AUTH_CREDENTIAL_KEY));
  assert.equal(persisted.refreshToken, 'refresh-new');
  assert.deepEqual(persisted.user, user);
});
