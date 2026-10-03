import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import { api, httpResponses, id } from './helpers/practice-api.mjs';
import { createLastProviderStore } from '../lib/last-provider.ts';
import {
  highlightedProvider,
  emailConflictDialog,
  emailConflictNotice,
  isSignupExpired,
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
  // 인가 요청에 state 를 쓰지 않았으면 키 자체를 싣지 않는다 — 서버가 난수를 채운다.
  assert.equal('state' in body, false);
});

test('account.login: 네이버 인가 요청에 쓴 state 는 그대로 실어 서버가 코드 교환에 쓰게 한다', () => {
  const body = loginRequestBody({
    provider: 'naver',
    authorizationCode: 'naver-code',
    codeVerifier: 'pkce-verifier',
    redirectUri: 'actingapp://oauth/naver',
    state: 'st-4f9a',
  });

  assert.deepEqual(body, {
    provider: 'naver',
    authorization_code: 'naver-code',
    code_verifier: 'pkce-verifier',
    redirect_uri: 'actingapp://oauth/naver',
    state: 'st-4f9a',
  });
  // 빈 state 는 없는 것과 같다. 쓰지 않은 값은 키 자체를 싣지 않는다.
  const blank = loginRequestBody({
    provider: 'naver',
    authorizationCode: 'naver-code',
    codeVerifier: 'pkce-verifier',
    redirectUri: 'actingapp://oauth/naver',
    state: '',
  });
  assert.equal('state' in blank, false);
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

test('account.login: 이메일 겹침 409는 서버 목록의 첫 제공자를 담은 팝업 안내가 된다', () => {
  const conflict = (providers) =>
    new ApiError(409, 'x', 'account_exists_with_different_provider', 'x', {
      detail: 'account_exists_with_different_provider',
      providers,
    });

  assert.deepEqual(emailConflictNotice(conflict(['google'])), {
    kind: 'email_conflict',
    provider: 'google',
  });
  assert.deepEqual(emailConflictNotice(conflict(['kakao', 'naver'])), {
    kind: 'email_conflict',
    provider: 'kakao',
  });
  assert.deepEqual(emailConflictNotice(conflict([])), { kind: 'email_conflict', provider: null });
  assert.equal(emailConflictNotice(new ApiError(400, 'x', 'unsupported_provider')), null);
  assert.equal(emailConflictNotice(new Error('network')), null);
});

test('account.login: 이메일 겹침 팝업은 이 빌드가 쓸 수 있는 제공자일 때만 계속하기를 둔다', () => {
  assert.deepEqual(emailConflictDialog('google', ['google', 'apple']), {
    title: '이미 가입한 계정이 있어요',
    message: '이 이메일은 Google로 가입돼 있어요.\nGoogle로 계속할까요?',
    continueWith: 'google',
  });
  // 안드로이드에서 애플로 가입한 계정 — 눌러서 실패하는 버튼을 만들지 않는다.
  assert.deepEqual(emailConflictDialog('apple', ['google']), {
    title: '이미 가입한 계정이 있어요',
    message: '이 이메일은 Apple로 가입돼 있어요.',
    continueWith: null,
  });
  const unknown = {
    title: '이미 가입한 계정이 있어요',
    message: '이 이메일은 다른 방식으로 가입돼 있어요.',
    continueWith: null,
  };
  assert.deepEqual(emailConflictDialog(null, ['google', 'apple']), unknown);
  assert.deepEqual(emailConflictDialog('facebook', ['google', 'apple']), unknown);
});

test('account.login: 가입 제출은 동의 결정과 만 14세 확인을 서버 계약대로 싣는다', async (t) => {
  const calls = httpResponses(t, [{
    body: {
      result: 'signed_in',
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 900,
      user: { id: id(1), email: null, status: 'active' },
      pending_consents: [],
    },
  }]);

  await api.signup('signup-token', [{ document_id: id(2), action: 'granted' }]);

  assert.deepEqual(calls[0].body, {
    signup_token: 'signup-token',
    decisions: [{ document_id: id(2), action: 'granted' }],
    age_confirmed: true,
  });
});
