import assert from 'node:assert/strict';
import test from 'node:test';

import { signOutBestEffort } from '../lib/auth-session.ts';

test('M3: 서버 logout이 비-ApiError로 실패해도 provider와 로컬 세션을 정리한다', async () => {
  const calls = [];

  await signOutBestEffort({
    serverLogout: async () => {
      calls.push('server');
      throw new TypeError('offline');
    },
    providerLogout: async () => {
      calls.push('provider');
    },
    clearLocalSession: async () => {
      calls.push('local');
    },
  });

  assert.deepEqual(calls, ['server', 'provider', 'local']);
});

test('M3: provider 정리가 실패해도 로컬 세션은 finally에서 정리한다', async () => {
  let localClearCalls = 0;

  await signOutBestEffort({
    serverLogout: async () => {},
    providerLogout: async () => {
      throw new Error('native provider error');
    },
    clearLocalSession: async () => {
      localClearCalls += 1;
    },
  });

  assert.equal(localClearCalls, 1);
});
