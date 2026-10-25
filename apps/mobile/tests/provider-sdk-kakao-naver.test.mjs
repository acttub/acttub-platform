import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// 카카오 네이티브 앱 키·네이버 client id 를 넣고 만든 빌드. 키는 모듈을 불러올 때 읽는다.
process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = ' kakao-native-key ';
process.env.EXPO_PUBLIC_NAVER_CLIENT_ID = 'naver-client';
process.env.EXPO_PUBLIC_API_URL = 'https://acttub.com/';

const state = {};
const kakao = {
  login: async () => {
    state.calls.push('kakao.login');
    if (state.kakaoError) throw state.kakaoError;
    return state.kakaoToken;
  },
  logout: async () => { state.calls.push('kakao.logout'); },
};
const browser = {
  openAuthSessionAsync: async (url, returnUrl) => {
    state.calls.push(['naver.open', returnUrl]);
    state.authorizeUrl = url;
    return state.browserResult(new URL(url).searchParams);
  },
};
const crypto = {
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: count => new Uint8Array(randomBytes(count)),
  digest: async (algorithm, data) => {
    assert.equal(algorithm, 'SHA-256');
    const hash = createHash('sha256').update(data).digest();
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
  },
};
globalThis.require = name => {
  if (name === '@react-native-google-signin/google-signin') throw new Error('not in this build');
  if (name === 'expo-apple-authentication') throw new Error('not in this build');
  if (name === '@react-native-seoul/kakao-login') return kakao;
  if (name === 'expo-web-browser') return browser;
  if (name === 'expo-crypto') return crypto;
  throw new Error(`unexpected require ${name}`);
};
globalThis.__nativeModules = { RNKakaoLogins: {} };
stubModules({
  'react-native': 'export const Platform = { OS: "android" }; export const NativeModules = globalThis.__nativeModules;',
});

const sdk = await import('../lib/provider-sdk.ts');
const { loginRequestBody } = await import('../lib/login-flow.ts');

const returned = (params) => `actingapp://auth/naver?${new URLSearchParams(params)}`;

beforeEach(() => {
  Object.assign(state, {
    calls: [], kakaoError: null, kakaoToken: null, authorizeUrl: null,
    browserResult: () => ({ type: 'cancel' }),
  });
  globalThis.__nativeModules.RNKakaoLogins = {};
});

test('키가 있는 빌드는 카카오·네이버를 쓸 수 있다', async () => {
  assert.deepEqual(await sdk.supportedProviders(), ['kakao', 'naver']);
});

test('카카오 네이티브 모듈이 없는 옛 dev client 는 카카오 버튼을 숨긴다', async () => {
  globalThis.__nativeModules.RNKakaoLogins = undefined;
  assert.equal(await sdk.providerAdapter('kakao').isAvailable(), false);
});

test('카카오 로그인은 받은 OIDC ID 토큰을 그대로 서버 요청에 싣는다', async () => {
  state.kakaoToken = { accessToken: 'access', idToken: 'kakao-id-token', scopes: ['openid'] };
  const credential = await sdk.providerAdapter('kakao').signIn();
  assert.deepEqual(credential, { provider: 'kakao', idToken: 'kakao-id-token' });
  assert.deepEqual(loginRequestBody(credential), { provider: 'kakao', id_token: 'kakao-id-token' });
  assert.deepEqual(state.calls, ['kakao.login']);
});

test('카카오 로그인 취소·동의 거절은 null, 다른 실패와 ID 토큰 없음은 던진다', async () => {
  for (const message of ['ClientFailed(Cancelled): no message', 'user cancelled.', 'AuthFailed(AccessDenied): User denied access']) {
    state.kakaoError = new Error(message);
    assert.equal(await sdk.providerAdapter('kakao').signIn(), null);
  }
  state.kakaoError = new Error('AuthFailed(Misconfigured): invalid android_key_hash');
  await assert.rejects(sdk.providerAdapter('kakao').signIn(), /Misconfigured/);

  state.kakaoError = null;
  state.kakaoToken = { accessToken: 'access', idToken: null };
  await assert.rejects(sdk.providerAdapter('kakao').signIn(), /no ID token/);
});

test('카카오 로그아웃은 기기의 카카오 토큰만 지운다', async () => {
  await sdk.signOutProviders();
  assert.deepEqual(state.calls, ['kakao.logout']);
});

test('네이버 로그인은 PKCE S256·state 로 OIDC 인가를 열고 코드와 verifier·redirect_uri·state 를 넘긴다', async () => {
  state.browserResult = (params) => ({ type: 'success', url: returned({ code: 'naver-code', state: params.get('state') }) });
  const credential = await sdk.providerAdapter('naver').signIn();

  const authorize = new URL(state.authorizeUrl);
  assert.equal(`${authorize.origin}${authorize.pathname}`, 'https://nid.naver.com/oauth2/authorize');
  const params = authorize.searchParams;
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'naver-client');
  assert.equal(params.get('redirect_uri'), 'https://acttub.com/auth/naver/callback');
  assert.equal(params.get('scope'), 'openid');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('code_challenge'), createHash('sha256').update(credential.codeVerifier).digest('base64url'));
  assert.deepEqual(state.calls, [['naver.open', 'actingapp://auth/naver']]);

  assert.deepEqual(loginRequestBody(credential), {
    provider: 'naver',
    authorization_code: 'naver-code',
    code_verifier: credential.codeVerifier,
    redirect_uri: 'https://acttub.com/auth/naver/callback',
    state: params.get('state'),
  });
  assert.match(credential.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
});

test('네이버 인가마다 verifier 와 state 가 새로 만들어진다', async () => {
  const seen = [];
  state.browserResult = (params) => {
    seen.push([params.get('state'), params.get('code_challenge')]);
    return { type: 'cancel' };
  };
  await sdk.providerAdapter('naver').signIn();
  await sdk.providerAdapter('naver').signIn();
  assert.notEqual(seen[0][0], seen[1][0]);
  assert.notEqual(seen[0][1], seen[1][1]);
});

test('네이버 창을 닫거나 동의를 취소하면 null 이다', async () => {
  for (const type of ['cancel', 'dismiss']) {
    state.browserResult = () => ({ type });
    assert.equal(await sdk.providerAdapter('naver').signIn(), null);
  }
  state.browserResult = (params) => ({
    type: 'success',
    url: returned({ state: params.get('state'), error: 'access_denied', error_description: 'Canceled By User' }),
  });
  assert.equal(await sdk.providerAdapter('naver').signIn(), null);
});

test('네이버가 돌려준 state 가 다르거나 없으면 코드가 있어도 서버에 보내지 않는다', async () => {
  state.browserResult = () => ({ type: 'success', url: returned({ code: 'naver-code', state: 'someone-else' }) });
  await assert.rejects(sdk.providerAdapter('naver').signIn(), /mismatched state/);
  state.browserResult = () => ({ type: 'success', url: returned({ code: 'naver-code' }) });
  await assert.rejects(sdk.providerAdapter('naver').signIn(), /mismatched state/);
});

test('네이버 오류·코드 없음·다른 세션 종료는 던진다', async () => {
  state.browserResult = (params) => ({ type: 'success', url: returned({ state: params.get('state'), error: 'server_error' }) });
  await assert.rejects(sdk.providerAdapter('naver').signIn(), /failed: server_error/);
  state.browserResult = (params) => ({ type: 'success', url: returned({ state: params.get('state') }) });
  await assert.rejects(sdk.providerAdapter('naver').signIn(), /no authorization code/);
  state.browserResult = () => ({ type: 'locked' });
  await assert.rejects(sdk.providerAdapter('naver').signIn(), /session ended: locked/);
});
