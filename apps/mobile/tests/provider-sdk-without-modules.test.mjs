import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/m4-stubs.mjs';

// 네이티브 로그인 모듈이 없는 안드로이드 빌드(재빌드 전 dev client). 앱은 떠야 하고 버튼은 그려지지 않는다.
delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const required = [];
globalThis.require = name => { required.push(name); throw new Error(`Cannot find module '${name}'`); };
stubModules({ 'react-native': 'export const Platform = { OS: "android" };' });

const sdk = await import('../lib/provider-sdk.ts');

test('모듈이 없으면 어떤 제공자도 로그인시킬 수 없고 정리는 조용히 끝난다', async () => {
  assert.ok(required.includes('@react-native-google-signin/google-signin'));
  assert.ok(!required.includes('expo-apple-authentication'), 'apple module is only loaded on iOS');
  assert.deepEqual(await sdk.supportedProviders(), []);
  await assert.rejects(sdk.providerAdapter('google').signIn(), /Google Sign-In native module is missing/);
  await assert.rejects(sdk.providerAdapter('apple').signIn(), /Apple Authentication native module is missing/);
  await sdk.signOutProviders();
  await sdk.disconnectProviders();
});
