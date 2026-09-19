import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import { createLastProviderStore } from '../lib/last-provider.ts';
import {
  highlightedProvider,
  isSignupExpired,
  loginErrorMessage,
  loginRequestBody,
  resolveLoginOutcome,
  visibleLoginProviders,
} from '../lib/login-flow.ts';

const ALL = ['google', 'apple', 'kakao', 'naver'];

test('account.login: 버튼은 서버가 켠 제공자와 이 빌드가 지원하는 제공자의 교집합만 그린다', () => {
  assert.deepEqual(
    visibleLoginProviders({
      enabled: ['google', 'apple', 'kakao'],
      supported: ALL,
      platform: 'ios',
    }),
    ['google', 'apple', 'kakao'],
  );
  // 서버가 카카오·네이버를 켰어도 SDK가 없는 빌드에서는 눌러서 실패하는 버튼을 만들지 않는다.
  assert.deepEqual(
    visibleLoginProviders({
      enabled: ALL,
      supported: ['google', 'apple'],
      platform: 'ios',
    }),
    ['google', 'apple'],
  );
});

test('account.login: 안드로이드는 서버가 애플을 켜 두었어도 애플 버튼을 빼고, iOS는 넷 다 그린다', () => {
  assert.deepEqual(
    visibleLoginProviders({ enabled: ALL, supported: ALL, platform: 'android' }),
    ['google', 'kakao', 'naver'],
  );
  assert.deepEqual(
    visibleLoginProviders({ enabled: ALL, supported: ALL, platform: 'ios' }),
    ALL,
  );
});

test('account.login: 버튼 순서는 서버 응답 순서가 아니라 앱이 정하고, 모르는 제공자와 개발용·게스트는 그리지 않는다', () => {
  assert.deepEqual(
    visibleLoginProviders({
      enabled: ['naver', 'development', 'guest', 'facebook', 'google', 'google'],
      supported: ALL,
      platform: 'ios',
    }),
    ['google', 'naver'],
  );
  assert.deepEqual(
    visibleLoginProviders({ enabled: [], supported: ALL, platform: 'ios' }),
    [],
  );
});

test('account.login: 마지막에 쓴 제공자가 버튼으로 나와 있을 때만 강조한다', () => {
  assert.equal(highlightedProvider(['google', 'kakao'], 'kakao'), 'kakao');
  assert.equal(highlightedProvider(['google'], 'kakao'), null);
  assert.equal(highlightedProvider(['google', 'kakao'], null), null);
});

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  };
}

test('account.login: 카카오로 로그인한 뒤 앱을 다시 열면 마지막 제공자가 카카오다', async () => {
  const storage = memoryStorage();
  await createLastProviderStore(storage).remember('kakao');

  // 앱을 다시 연 것처럼 같은 저장소로 새 store를 만든다.
  assert.equal(await createLastProviderStore(storage).read(), 'kakao');
});

test('account.login: 마지막 제공자 기억은 계정 자료를 쓸어 내는 acttub. 접두사 밖에 둔다', async () => {
  const storage = memoryStorage();
  await createLastProviderStore(storage).remember('naver');

  assert.equal(storage.items.size, 1);
  for (const key of storage.items.keys()) {
    assert.equal(key.startsWith('acttub.'), false, `${key}는 로그아웃 때 쓸려 나갈 수 있다`);
  }
});

test('account.login: 저장소를 못 읽거나 모르는 값이면 강조 없이 시작하고, 잊으면 사라진다', async () => {
  const broken = {
    getItem: async () => {
      throw new Error('storage down');
    },
    setItem: async () => {
      throw new Error('storage down');
    },
    removeItem: async () => {},
  };
  assert.equal(await createLastProviderStore(broken).read(), null);
  await createLastProviderStore(broken).remember('google'); // 실패해도 로그인을 막지 않는다

  const storage = memoryStorage();
  const store = createLastProviderStore(storage);
  await store.remember('google');
  storage.items.set([...storage.items.keys()][0], 'facebook');
  assert.equal(await store.read(), null);

  await store.remember('apple');
  await store.forget();
  assert.equal(await store.read(), null);
});

test('account.login: 구글·카카오는 ID 토큰을 싣고, 애플은 authorization code를 함께 싣는다', () => {
  assert.deepEqual(loginRequestBody({ provider: 'google', idToken: 'google-token' }), {
    provider: 'google',
    id_token: 'google-token',
  });
  assert.deepEqual(
    loginRequestBody({ provider: 'kakao', idToken: 'kakao-token', displayName: '김배우' }),
    { provider: 'kakao', id_token: 'kakao-token' },
  );
  assert.deepEqual(
    loginRequestBody({
      provider: 'apple',
      idToken: 'apple-token',
      authorizationCode: 'apple-code',
      displayName: '김배우',
    }),
    { provider: 'apple', id_token: 'apple-token', authorization_code: 'apple-code' },
  );
});

test('account.login: 네이버는 ID 토큰이 아니라 authorization code·code verifier·redirect uri를 싣는다', () => {
  const body = loginRequestBody({
    provider: 'naver',
    authorizationCode: 'naver-code',
    codeVerifier: 'pkce-verifier',
    redirectUri: 'actingapp://oauth/naver',
  });

  assert.deepEqual(body, {
    provider: 'naver',
    authorization_code: 'naver-code',
    code_verifier: 'pkce-verifier',
    redirect_uri: 'actingapp://oauth/naver',
  });
  // 교환은 서버가 client secret으로 한다. 앱이 보내는 본문에 비밀이나 ID 토큰은 없다.
  assert.equal('id_token' in body, false);
  assert.equal('client_secret' in body, false);
});

test('account.login: 자격 값이 빠졌으면 서버에 보내지 않고 막는다', () => {
  // 애플에 authorization code가 없으면 서버가 422(authorization_code_required)로 거절한다.
  assert.throws(() =>
    loginRequestBody({ provider: 'apple', idToken: 'apple-token', authorizationCode: null }),
  );
  assert.throws(() => loginRequestBody({ provider: 'google', idToken: '' }));
  assert.throws(() =>
    loginRequestBody({
      provider: 'naver',
      authorizationCode: 'naver-code',
      codeVerifier: '',
      redirectUri: 'actingapp://oauth/naver',
    }),
  );
});

const pair = {
  access_token: 'access',
  refresh_token: 'refresh',
  token_type: 'bearer',
  expires_in: 1800,
  user: { id: 'user-1', email: null, status: 'active' },
  pending_consents: [],
};

test('account.login: result가 signed_in이면 토큰으로 로그인한다', () => {
  const outcome = resolveLoginOutcome(
    { result: 'signed_in', ...pair },
    { provider: 'google', displayName: '김배우', now: 1_000 },
  );

  assert.equal(outcome.kind, 'signed_in');
  assert.equal(outcome.pair.access_token, 'access');
  assert.equal(outcome.pair.user.id, 'user-1');
});

test('account.login: result가 signup_required이면 토큰 없이 가입 토큰과 문서를 들고 동의 화면으로 간다', () => {
  const documents = [
    { id: 'doc-terms', type: 'terms', required: true },
    { id: 'doc-retention', type: 'retention', required: false },
  ];
  const outcome = resolveLoginOutcome(
    { result: 'signup_required', signup_token: 'signup-token', expires_in: 1800, documents },
    { provider: 'apple', displayName: '김배우', now: 1_000 },
  );

  assert.deepEqual(outcome, {
    kind: 'signup_required',
    signup: {
      provider: 'apple',
      signupToken: 'signup-token',
      documents,
      expiresAt: 1_000 + 1800 * 1000,
      // 애플은 이름을 처음 한 번만 준다. 프로필 화면까지 들고 간다.
      displayName: '김배우',
    },
  });
});

test('account.login: result를 알 수 없는 응답은 로그인으로 치지 않는다', () => {
  assert.throws(() =>
    resolveLoginOutcome({ ...pair }, { provider: 'google', displayName: null, now: 0 }),
  );
  assert.throws(() =>
    resolveLoginOutcome(
      { result: 'signup_required', expires_in: 1800, documents: [] },
      { provider: 'google', displayName: null, now: 0 },
    ),
  );
});

test('account.login: 가입 토큰은 30분 뒤 만료로 본다', () => {
  const signup = { expiresAt: 1_000 + 1800 * 1000 };
  assert.equal(isSignupExpired(signup, 1_000 + 1799 * 1000), false);
  assert.equal(isSignupExpired(signup, 1_000 + 1800 * 1000), true);
});

test('account.login: 이메일 겹침 409는 "이미 OO로 가입한 이메일이에요"로 기존 제공자를 알려 준다', () => {
  const conflict = (providers) =>
    new ApiError(409, 'x', 'account_exists_with_different_provider', 'x', {
      detail: 'account_exists_with_different_provider',
      providers,
    });

  assert.equal(loginErrorMessage(conflict(['google'])), '이미 구글로 가입한 이메일이에요');
  assert.equal(
    loginErrorMessage(conflict(['kakao', 'naver'])),
    '이미 카카오·네이버로 가입한 이메일이에요',
  );
  // 제공자 이름이 실리지 않았어도 막힌 이유는 말해 준다.
  assert.match(loginErrorMessage(conflict([])), /이미 다른 방식으로 가입한 이메일이에요/);
});

test('account.login: 꺼 둔 제공자 400, 잘못된 토큰 401, 제공자 무응답 502는 각각 다른 안내다', () => {
  const disabled = loginErrorMessage(new ApiError(400, 'x', 'unsupported_provider'));
  const invalid = loginErrorMessage(new ApiError(401, 'x', 'invalid_provider_token'));
  const unavailable = loginErrorMessage(new ApiError(502, 'x', 'provider_unavailable'));

  assert.match(disabled, /다른 방식/);
  assert.match(invalid, /다시 시도/);
  assert.match(unavailable, /잠시 (뒤|후)/);
  assert.equal(new Set([disabled, invalid, unavailable]).size, 3);
  // 그 밖의 오류는 요청 계층이 만든 문장을 그대로 쓴다.
  assert.equal(loginErrorMessage(new ApiError(429, '잠시 몰렸어요', 'rate limit exceeded')), '잠시 몰렸어요');
});
