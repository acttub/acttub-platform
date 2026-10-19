import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_CREDENTIAL_KEY,
  LEGACY_ACCESS_KEY,
  LEGACY_REFRESH_KEY,
  LEGACY_USER_KEY,
  createAuthCredentialStore,
  readJwtSubject,
} from '../lib/auth-credentials.ts';

const b64 = value => Buffer.from(value, 'utf8').toString('base64url');
const jwt = payload => `${b64('{"alg":"HS256"}')}.${b64(typeof payload === 'string' ? payload : JSON.stringify(payload))}.sig`;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    deleteItem: async key => {
      values.delete(key);
    },
  };
}

const userA = { id: 'user-a', email: 'a@test.dev', status: 'active' };
const accessA = jwt({ sub: 'user-a' });

test('readJwtSubject: sub 가 있는 JWT 만 주체를 낸다', () => {
  const cases = [
    [accessA, 'user-a'],
    ['only.two', null],
    ['a..c', null],
    ['a.A.c', null], // base64url 길이 4n+1 은 올바른 인코딩이 아니다
    ['a.ey*J.c', null], // base64url 밖의 글자
    ['a.AB.c', null], // 남는 비트가 0 이 아니다
    [jwt('not json'), null],
    [jwt('null'), null],
    [jwt('["user-a"]'), null],
    [jwt({ sub: '' }), null],
    [jwt({ sub: 42 }), null],
    [jwt({ name: 'no sub' }), null],
  ];
  for (const [token, expected] of cases) assert.equal(readJwtSubject(token), expected, token);
});

test('load: 저장된 기록이 JSON 이 아니면 모든 키를 지우고 로그인 전 상태다', async () => {
  const storage = memoryStorage({ [AUTH_CREDENTIAL_KEY]: '{broken', [LEGACY_ACCESS_KEY]: accessA });
  assert.equal(await createAuthCredentialStore(storage).load(), null);
  assert.deepEqual([...storage.values.keys()], []);
});

test('load: 저장된 기록의 사용자 모양이 틀리면 버린다', async () => {
  const badUsers = [
    null,
    ['user-a'],
    { id: '', email: null, status: 'active' },
    { id: 'user-a', email: 7, status: 'active' },
    { id: 'user-a', email: null, status: 'banned' },
  ];
  for (const user of badUsers) {
    const record = { schemaVersion: 1, accessToken: accessA, refreshToken: 'r', user };
    const storage = memoryStorage({ [AUTH_CREDENTIAL_KEY]: JSON.stringify(record) });
    assert.equal(await createAuthCredentialStore(storage).load(), null, JSON.stringify(user));
    assert.equal(storage.values.size, 0);
  }
});

test('load: 옛 저장에 refresh 토큰이 빠져 있으면 이관하지 않고 지운다', async () => {
  const storage = memoryStorage({ [LEGACY_ACCESS_KEY]: accessA, [LEGACY_USER_KEY]: JSON.stringify(userA) });
  assert.equal(await createAuthCredentialStore(storage).load(), null);
  assert.equal(storage.values.size, 0);
});

test('load: 옛 저장의 사용자 기록이 JWT 주체와 같으면 이메일까지 살려 새 형식으로 옮긴다', async () => {
  const storage = memoryStorage({
    [LEGACY_ACCESS_KEY]: accessA,
    [LEGACY_REFRESH_KEY]: 'refresh-a',
    [LEGACY_USER_KEY]: JSON.stringify(userA),
  });
  const expected = { schemaVersion: 1, accessToken: accessA, refreshToken: 'refresh-a', user: userA };
  assert.deepEqual(await createAuthCredentialStore(storage).load(), expected);
  assert.deepEqual([...storage.values.keys()], [AUTH_CREDENTIAL_KEY]);
  assert.deepEqual(JSON.parse(storage.values.get(AUTH_CREDENTIAL_KEY)), expected);
});

test('load: 옛 사용자 기록이 깨졌으면 JWT 주체로 사용자를 만든다', async () => {
  const storage = memoryStorage({
    [LEGACY_ACCESS_KEY]: accessA,
    [LEGACY_REFRESH_KEY]: 'refresh-a',
    [LEGACY_USER_KEY]: '{not json',
  });
  const record = await createAuthCredentialStore(storage).load();
  assert.deepEqual(record.user, { id: 'user-a', email: null, status: 'active' });
});

test('load: 옛 사용자 기록이 다른 사람이면 섞지 않고 지운다', async () => {
  const storage = memoryStorage({
    [LEGACY_ACCESS_KEY]: accessA,
    [LEGACY_REFRESH_KEY]: 'refresh-a',
    [LEGACY_USER_KEY]: JSON.stringify({ ...userA, id: 'user-b' }),
  });
  assert.equal(await createAuthCredentialStore(storage).load(), null);
  assert.equal(storage.values.size, 0);
});

test('save: 토큰 주체와 사용자가 다르면 저장하지 않고 던진다', async () => {
  const storage = memoryStorage();
  await assert.rejects(
    createAuthCredentialStore(storage).save(jwt({ sub: 'user-b' }), 'refresh', userA),
    { message: '유효한 인증 credential을 저장할 수 없습니다.' },
  );
  assert.equal(storage.values.size, 0);
});

test('saveRefreshed: 새 access 토큰에서 주체를 못 읽으면 저장하지 않고 던진다', async () => {
  const storage = memoryStorage();
  await assert.rejects(
    createAuthCredentialStore(storage).saveRefreshed('opaque-token', 'refresh', userA),
    { message: 'refresh credential의 사용자 정보를 확인할 수 없습니다.' },
  );
  assert.equal(storage.values.size, 0);
});

test('saveRefreshed: 같은 주체면 지금 사용자(이메일 포함)를 그대로 둔다', async () => {
  const storage = memoryStorage();
  const record = await createAuthCredentialStore(storage).saveRefreshed(jwt({ sub: 'user-a', iat: 2 }), 'refresh-2', userA);
  assert.deepEqual(record.user, userA);
  assert.equal(record.refreshToken, 'refresh-2');
});

test('load: 저장된 기록이 객체가 아니면(null·배열) 버린다', async () => {
  for (const raw of ['null', '[]', '"text"']) {
    const storage = memoryStorage({ [AUTH_CREDENTIAL_KEY]: raw });
    assert.equal(await createAuthCredentialStore(storage).load(), null, raw);
    assert.equal(storage.values.size, 0);
  }
});

test('load: 옛 저장의 일부 키만 남아 있으면 이관하지 않고 남은 키를 지운다', async () => {
  for (const leftover of [{ [LEGACY_REFRESH_KEY]: 'refresh-a' }, { [LEGACY_USER_KEY]: JSON.stringify(userA) }]) {
    const storage = memoryStorage(leftover);
    assert.equal(await createAuthCredentialStore(storage).load(), null);
    assert.equal(storage.values.size, 0);
  }
});

test('load: 옛 사용자 기록이 JSON 이지만 사용자 모양이 아니면 JWT 주체로 사용자를 만든다', async () => {
  const storage = memoryStorage({
    [LEGACY_ACCESS_KEY]: accessA,
    [LEGACY_REFRESH_KEY]: 'refresh-a',
    [LEGACY_USER_KEY]: '{"id":5}',
  });
  const record = await createAuthCredentialStore(storage).load();
  assert.deepEqual(record.user, { id: 'user-a', email: null, status: 'active' });
});

test('load: 아무것도 저장된 적 없으면 null 이고 키체인에 쓰지도 지우지도 않는다', async () => {
  const touched = [];
  const storage = memoryStorage();
  const watched = {
    getItem: storage.getItem,
    setItem: async key => touched.push(['set', key]),
    deleteItem: async key => touched.push(['delete', key]),
  };
  assert.equal(await createAuthCredentialStore(watched).load(), null);
  assert.deepEqual(touched, []);
});
