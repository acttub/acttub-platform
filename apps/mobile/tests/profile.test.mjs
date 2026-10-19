import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/m4-stubs.mjs';

const state = { values: new Map(), fail: false };
globalThis.__profileStore = state;
stubModules({
  'expo-secure-store': `const s = globalThis.__profileStore;
    const check = () => { if (s.fail) throw new Error('keychain locked'); };
    export const setItemAsync = async (k, v) => { check(); s.values.set(k, v); };
    export const getItemAsync = async k => { check(); return s.values.get(k) ?? null; };
    export const deleteItemAsync = async k => { check(); s.values.delete(k); };`,
});
const profile = await import('../lib/profile.ts');

test('이름을 다듬어 기기에 적고 읽으며, 탈퇴 때 지운다', async () => {
  await profile.saveUserName('  민지 ');
  assert.equal(await profile.getUserName(), '민지');
  assert.equal(state.values.get('acttub.userName'), '민지');
  await profile.deleteUserName();
  assert.equal(await profile.getUserName(), null);
});

test('키체인을 못 쓰면 읽기는 null, 지우기는 조용히 넘어간다', async () => {
  state.fail = true;
  try {
    assert.equal(await profile.getUserName(), null);
    await profile.deleteUserName();
    await assert.rejects(profile.saveUserName('민지'), /keychain locked/);
  } finally {
    state.fail = false;
  }
});

test('제공자가 준 이름 힌트는 한 번만 꺼내 쓰고, 빈 이름은 버린다', () => {
  profile.setProviderNameHint('  김민지 ');
  assert.equal(profile.takeProviderNameHint(), '김민지');
  assert.equal(profile.takeProviderNameHint(), null);
  profile.setProviderNameHint('   ');
  assert.equal(profile.takeProviderNameHint(), null);
  profile.setProviderNameHint(undefined);
  assert.equal(profile.takeProviderNameHint(), null);
});
