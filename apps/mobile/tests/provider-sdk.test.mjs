import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// iOS 빌드에 구글·애플 SDK 가 모두 있는 경우. SDK 만 바꾸고 어댑터 규칙은 그대로 돈다.
process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client';
process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client';
const state = { calls: [], configured: null };
const google = {
  GoogleSignin: {
    configure: options => { state.configured = options; },
    hasPlayServices: async options => { state.calls.push(['hasPlayServices', options]); },
    signIn: async () => state.googleResult,
    getTokens: async () => ({ idToken: state.fallbackToken ?? null }),
    signOut: async () => { state.calls.push(['google.signOut']); if (state.googleSignOutFails) throw new Error('no session'); },
    revokeAccess: async () => { state.calls.push(['google.revoke']); throw new Error('no google session'); },
  },
};
const apple = {
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: async () => { if (state.appleAvailableFails) throw new Error('boom'); return true; },
  signInAsync: async options => { state.calls.push(['apple.signIn', options]); if (state.appleError) throw state.appleError; return state.appleCredential; },
};
globalThis.require = name => {
  if (name === '@react-native-google-signin/google-signin') return google;
  if (name === 'expo-apple-authentication') return apple;
  throw new Error(`unexpected require ${name}`);
};
stubModules({ 'react-native': 'export const Platform = { OS: "ios" }; export const NativeModules = {};' });

const sdk = await import('../lib/provider-sdk.ts');

beforeEach(() => {
  Object.assign(state, { calls: [], googleResult: null, fallbackToken: null, googleSignOutFails: false, appleError: null, appleCredential: null, appleAvailableFails: false });
});

test('구글 SDK 를 공개 클라이언트 ID 로 설정한다', () => {
  assert.deepEqual(state.configured, { webClientId: 'web-client', iosClientId: 'ios-client' });
});

test('iOS 빌드는 구글·애플만 로그인시킬 수 있다', async () => {
  assert.deepEqual(await sdk.supportedProviders(), ['google', 'apple']);
  state.appleAvailableFails = true;
  assert.deepEqual(await sdk.supportedProviders(), ['google']);
});

test('구글 로그인은 새 응답 모양에서 ID 토큰과 이름을 꺼낸다', async () => {
  state.googleResult = { type: 'success', data: { idToken: 'g-token', user: { name: '김민지', givenName: '민지' } } };
  assert.deepEqual(await sdk.providerAdapter('google').signIn(), { provider: 'google', idToken: 'g-token', displayName: '민지' });
  assert.deepEqual(state.calls, [['hasPlayServices', { showPlayServicesUpdateDialog: true }]]);
});

test('옛 응답 모양이면 바깥 칸을 읽고, 토큰이 없으면 토큰을 따로 받는다', async () => {
  state.googleResult = { idToken: null, user: { name: '김민지', givenName: null } };
  state.fallbackToken = 'g-fallback';
  assert.deepEqual(await sdk.providerAdapter('google').signIn(), { provider: 'google', idToken: 'g-fallback', displayName: '김민지' });

  state.googleResult = {};
  state.fallbackToken = null;
  assert.equal(await sdk.providerAdapter('google').signIn(), null);
});

test('구글 로그인을 취소하면 null 이다', async () => {
  state.googleResult = { type: 'cancelled' };
  assert.equal(await sdk.providerAdapter('google').signIn(), null);
});

test('애플 로그인은 이름·이메일을 청하고 한 번 쓰는 코드와 이름을 함께 넘긴다', async () => {
  state.appleCredential = { identityToken: 'a-token', authorizationCode: 'a-code', fullName: { familyName: '김', givenName: '민지' } };
  assert.deepEqual(await sdk.providerAdapter('apple').signIn(), {
    provider: 'apple', idToken: 'a-token', authorizationCode: 'a-code', displayName: '김민지',
  });
  assert.deepEqual(state.calls, [['apple.signIn', { requestedScopes: [0, 1] }]]);

  state.appleCredential = { identityToken: 'a-token', authorizationCode: 'a-code', fullName: null };
  assert.equal((await sdk.providerAdapter('apple').signIn()).displayName, null);
});

test('애플 로그인 취소는 null, 다른 실패와 토큰 없음은 던진다', async () => {
  for (const code of ['ERR_REQUEST_CANCELED', 'ERR_CANCELED']) {
    state.appleError = Object.assign(new Error('cancel'), { code });
    assert.equal(await sdk.providerAdapter('apple').signIn(), null);
  }
  state.appleError = Object.assign(new Error('failed'), { code: 'ERR_REQUEST_FAILED' });
  await assert.rejects(sdk.providerAdapter('apple').signIn(), /failed/);

  state.appleError = null;
  state.appleCredential = { identityToken: null, authorizationCode: 'c' };
  await assert.rejects(sdk.providerAdapter('apple').signIn(), /no identity token/);
});

test('카카오 앱 키·네이버 client id 가 없는 빌드는 두 제공자를 숨기고 모듈도 부르지 않는다', async () => {
  for (const provider of ['kakao', 'naver']) {
    assert.equal(await sdk.providerAdapter(provider).isAvailable(), false);
  }
  await assert.rejects(sdk.providerAdapter('kakao').signIn(), /native module is missing/);
  await assert.rejects(sdk.providerAdapter('naver').signIn(), /needs expo-web-browser/);
});

test('로그아웃은 하나가 실패해도 모든 제공자 세션을 정리한다', async () => {
  state.googleSignOutFails = true;
  await sdk.signOutProviders();
  assert.deepEqual(state.calls, [['google.signOut']]);
});

test('탈퇴 직전의 연결 해제는 구글만 SDK 로 끊고, 실패해도 던지지 않는다', async () => {
  await sdk.disconnectProviders();
  assert.deepEqual(state.calls, [['google.revoke']]);
});
