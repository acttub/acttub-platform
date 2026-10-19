import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

// 저장소·파일·이름 캐시만 바꾸고 지우는 순서(local-account-wipe)는 그대로 돈다.
const state = { storage: memoryStorage(), calls: [] };
globalThis.__localAccount = state;
stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__localAccount.storage;',
  '@/lib/account-files': `const s = globalThis.__localAccount;
    export const deleteDeviceFile = async uri => { s.calls.push(['delete', uri]); };
    export const listSpeechFiles = async () => ['file:///cache/reading-s1-l1.wav'];
    export const purgeDeviceFiles = async () => { s.calls.push(['purgeDeviceFiles']); };
    export const purgeLibraryFiles = async () => { s.calls.push(['purgeLibraryFiles']); };`,
  '@/lib/profile': `const s = globalThis.__localAccount;
    export const deleteUserName = async () => { s.calls.push(['deleteUserName']); };`,
});
const { clearAccountCache, clearLocalAccountData } = await import('../lib/local-account-data.ts');

const seed = () => {
  state.storage.values.clear();
  state.calls = [];
  for (const key of ['acttub.push.settings', 'acttub.profileBio', 'acttub.practiceDays.v1', 'device.pendingPushTokenDeletions']) {
    state.storage.values.set(key, '1');
  }
};

test('로그아웃은 계정 캐시와 이름만 지우고 연습 기록은 남긴다', async () => {
  seed();
  await clearAccountCache();
  assert.deepEqual([...state.storage.values.keys()].sort(), ['acttub.practiceDays.v1', 'device.pendingPushTokenDeletions']);
  assert.deepEqual(state.calls, [['deleteUserName']]);
});

test('탈퇴는 기기의 계정 파일과 acttub. 키를 모두 지운다', async () => {
  seed();
  await clearLocalAccountData();
  assert.deepEqual([...state.storage.values.keys()], ['device.pendingPushTokenDeletions']);
  assert.deepEqual(state.calls.map(([name]) => name).sort(), ['delete', 'deleteUserName', 'purgeDeviceFiles', 'purgeLibraryFiles']);
  assert.deepEqual(state.calls.find(([name]) => name === 'delete'), ['delete', 'file:///cache/reading-s1-l1.wav']);
});
