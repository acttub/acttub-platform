import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// 키체인(SecureStore)만 메모리 Map 으로 바꾼다. 저장 형식·큐·구독은 실제 lib 코드가 돈다.
const secureStore = new Map();
globalThis.__m4n1SecureStore = secureStore;
const stubs = {
  'expo-secure-store': 'const v = globalThis.__m4n1SecureStore; export const getItemAsync = async k => v.get(k) ?? null; export const setItemAsync = async (k, x) => { v.set(k, x); }; export const deleteItemAsync = async k => { v.delete(k); };',
};
registerHooks({
  resolve(specifier, context, next) {
    if (stubs[specifier]) return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    if (specifier.startsWith('@/')) specifier = new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href;
    return next(specifier, context);
  },
});
const store = await import('../lib/token-store.ts');

function jwtWithSubject(subject) {
  const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject })}.signature`;
}

const userA = { id: '11111111-1111-4111-8111-111111111111', email: 'a@test.dev', status: 'active' };
const userB = { id: '22222222-2222-4222-8222-222222222222', email: null, status: 'active' };
const accessA = jwtWithSubject(userA.id);
const stored = () => JSON.parse(secureStore.get('acttub.authCredentials') ?? 'null');

// 모듈 하나의 세션을 앱이 쓰는 순서대로 이어 간다: 시작 → 로그인 → 갱신 → 계정 교정 → 로그아웃.
test('앱 시작: 저장된 자격증명이 없으면 로그인 전 상태다', async () => {
  assert.equal(await store.loadTokens(), false);
  await store.waitForCredentialReady();
  assert.equal(store.getAccessToken(), null);
  assert.equal(store.getRefreshToken(), null);
  assert.equal(store.getStoredUser(), null);
});

test('로그인: 토큰과 사용자를 키체인에 한 기록으로 남기고 세션 경계를 하나 올린다', async () => {
  const epoch = store.getAuthSessionEpoch();
  assert.equal(await store.setTokens(accessA, 'refresh-a1', userA), true);
  assert.equal(store.getAccessToken(), accessA);
  assert.equal(store.getRefreshToken(), 'refresh-a1');
  assert.deepEqual(store.getStoredUser(), userA);
  assert.equal(store.getAuthSessionEpoch(), epoch + 1);
  assert.deepEqual(stored(), { schemaVersion: 1, accessToken: accessA, refreshToken: 'refresh-a1', user: userA });
  assert.equal(await store.loadTokens(), true);
});

test('토큰 갱신: 같은 사람이면 토큰만 바꾸고 세션 경계는 그대로다', async () => {
  const epoch = store.getAuthSessionEpoch();
  const accessA2 = jwtWithSubject(userA.id);
  const result = await store.commitRefreshedTokens(accessA2, 'refresh-a2', { authSessionEpoch: epoch, refreshToken: 'refresh-a1' });
  assert.equal(result, 'refreshed');
  assert.equal(store.getRefreshToken(), 'refresh-a2');
  assert.deepEqual(store.getStoredUser(), userA);
  assert.equal(store.getAuthSessionEpoch(), epoch);
  assert.equal(stored().refreshToken, 'refresh-a2');
});

test('토큰 갱신: 이미 지나간 refresh 토큰으로 온 결과는 버린다', async () => {
  const before = store.getRefreshToken();
  const result = await store.commitRefreshedTokens(jwtWithSubject(userA.id), 'refresh-late', {
    authSessionEpoch: store.getAuthSessionEpoch(),
    refreshToken: 'refresh-a1',
  });
  assert.equal(result, 'stale');
  assert.equal(store.getRefreshToken(), before);
});

test('토큰 갱신이 다른 사람을 가리키면 사용자 변경을 알리고 세션 경계를 올린다', async () => {
  const changed = [];
  const unsubscribe = store.onStoredUserChanged(user => changed.push(user));
  const epoch = store.getAuthSessionEpoch();
  const result = await store.commitRefreshedTokens(jwtWithSubject(userB.id), 'refresh-b1', {
    authSessionEpoch: epoch,
    refreshToken: store.getRefreshToken(),
  });
  unsubscribe();
  assert.equal(result, 'principal_changed');
  assert.deepEqual(changed, [userB]);
  assert.deepEqual(store.getStoredUser(), userB);
  assert.equal(store.getAuthSessionEpoch(), epoch + 1);
});

test('조건부 로그아웃: 기대한 세션이 아니면 지우지 않고, 맞으면 지우고 구독자에게 알린다', async () => {
  let cleared = 0;
  const unsubscribe = store.onTokensCleared(() => {
    cleared += 1;
  });
  const current = { authSessionEpoch: store.getAuthSessionEpoch(), refreshToken: store.getRefreshToken() };

  assert.equal(await store.clearTokensIfCurrent({ ...current, refreshToken: 'someone-else' }), false);
  assert.equal(store.getRefreshToken(), 'refresh-b1');
  assert.equal(cleared, 0);

  assert.equal(await store.clearTokensIfCurrent(current), true);
  assert.equal(store.getAccessToken(), null);
  assert.equal(stored(), null);
  assert.equal(cleared, 1);

  unsubscribe();
  await store.setTokens(accessA, 'refresh-a3', userA);
  await store.clearTokens();
  assert.equal(cleared, 1, '구독을 끊은 뒤에는 알리지 않는다');
  assert.equal(store.getStoredUser(), null);
});

test('게이트 알림: 동의·프로필·업데이트·탈퇴 구독자는 끊기 전까지만 받는다', () => {
  const seen = [];
  const offs = [
    store.onConsentRequired(docs => seen.push(['consent', docs])),
    store.onProfileRequired(() => seen.push(['profile'])),
    store.onUpdateRequired(() => seen.push(['update'])),
    store.onAccountDeactivated(() => seen.push(['deactivated'])),
  ];
  const pending = [{ id: 'doc-1', type: 'marketing', required: false }];
  store.emitConsentRequired(pending);
  store.emitProfileRequired();
  store.emitUpdateRequired();
  store.emitAccountDeactivated();
  for (const off of offs) off();
  store.emitConsentRequired([]);
  store.emitProfileRequired();
  store.emitUpdateRequired();
  store.emitAccountDeactivated();
  assert.deepEqual(seen, [['consent', pending], ['profile'], ['update'], ['deactivated']]);
});
