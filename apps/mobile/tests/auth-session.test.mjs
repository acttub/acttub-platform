import assert from 'node:assert/strict';
import test from 'node:test';

import { signOutBestEffort, withdrawAccount } from '../lib/auth-session.ts';

function recorder(failing = []) {
  const calls = [];
  const step = (name) => async () => {
    calls.push(name);
    if (failing.includes(name)) throw new TypeError(`${name} failed`);
  };
  return { calls, step };
}

function signOutSteps(step) {
  return {
    deletePushToken: step('push'),
    serverLogout: step('server'),
    providerLogout: step('provider'),
    cancelReminders: step('reminders'),
    clearLocalSession: step('local'),
  };
}

test('account.logout: 순서는 푸시 토큰 삭제 → 리프레시 토큰 폐기 → 제공자 세션 정리 → 기기 토큰 삭제다', async () => {
  const { calls, step } = recorder();

  await signOutBestEffort(signOutSteps(step));

  assert.deepEqual(
    calls.filter((name) => name !== 'reminders'),
    ['push', 'server', 'provider', 'local'],
  );
  // 기기 토큰 삭제가 마지막이다. 그 전에 리마인드 알람도 전부 취소한다.
  assert.ok(calls.indexOf('reminders') < calls.indexOf('local'));
});

test('account.logout: 비행기 모드에서 로그아웃하면 네트워크 단계가 다 실패해도 기기 토큰을 지우고 로그인 화면으로 간다', async () => {
  const { calls, step } = recorder(['push', 'server']);

  await signOutBestEffort(signOutSteps(step));

  assert.deepEqual(calls, ['push', 'server', 'provider', 'reminders', 'local']);
});

test('account.logout: 앞 단계가 하나씩 실패해도 뒤 단계는 모두 진행한다', async () => {
  for (const failing of ['push', 'server', 'provider', 'reminders']) {
    const { calls, step } = recorder([failing]);

    await signOutBestEffort(signOutSteps(step));

    assert.deepEqual(calls, ['push', 'server', 'provider', 'reminders', 'local'], failing);
  }
});

test('account.logout: 로그아웃 뒤 예약된 리마인드 알람은 0개다', async () => {
  let scheduled = 30;
  const { step } = recorder();

  await signOutBestEffort({
    ...signOutSteps(step),
    cancelReminders: async () => {
      scheduled = 0;
    },
  });

  assert.equal(scheduled, 0);
});

function withdrawSteps(step) {
  return {
    disconnectProviders: step('disconnect'),
    serverWithdraw: step('server'),
    forgetPushToken: step('push'),
    cancelReminders: step('reminders'),
    wipeLocalData: step('wipe'),
    forgetLastProvider: step('lastProvider'),
    providerLogout: step('provider'),
    clearLocalSession: step('local'),
  };
}

test('account.withdraw: 구글 연결 해제는 탈퇴 요청 직전에 부르고, 기기 자료는 서버 파기가 성공한 뒤에만 지운다', async () => {
  const { calls, step } = recorder();

  await withdrawAccount(withdrawSteps(step));

  assert.deepEqual(calls.slice(0, 2), ['disconnect', 'server']);
  for (const local of ['push', 'reminders', 'wipe', 'lastProvider', 'provider', 'local']) {
    assert.ok(calls.indexOf(local) > calls.indexOf('server'), `${local}이 서버 파기보다 먼저다`);
  }
  assert.equal(calls.at(-1), 'local');
});

test('account.withdraw: 앱의 제공자 연결 해제가 실패해도 탈퇴는 진행한다', async () => {
  const { calls, step } = recorder(['disconnect']);

  await withdrawAccount(withdrawSteps(step));

  assert.ok(calls.includes('server'));
  assert.equal(calls.at(-1), 'local');
});

test('account.withdraw: 서버 파기가 실패하면 기기에서 아무것도 지우지 않고 오류를 올린다 — 계정은 그대로다', async () => {
  const { calls, step } = recorder(['server']);

  await assert.rejects(withdrawAccount(withdrawSteps(step)), /server failed/);

  assert.deepEqual(calls, ['disconnect', 'server']);
});

test('account.withdraw: 탈퇴 도중 실패해 다시 눌러도 같은 절차로 끝난다', async () => {
  let attempts = 0;
  const { calls, step } = recorder();
  const steps = {
    ...withdrawSteps(step),
    serverWithdraw: async () => {
      calls.push('server');
      attempts += 1;
      if (attempts === 1) throw new TypeError('offline');
    },
  };

  await assert.rejects(withdrawAccount(steps));
  await withdrawAccount(steps);

  assert.equal(attempts, 2);
  assert.equal(calls.at(-1), 'local');
  assert.equal(calls.filter((name) => name === 'wipe').length, 1);
});

test('account.withdraw: 서버가 끝낸 뒤에는 기기 정리가 하나 실패해도 끝까지 가서 기기 토큰을 지운다', async () => {
  for (const failing of ['push', 'reminders', 'wipe', 'lastProvider', 'provider']) {
    const { calls, step } = recorder([failing]);

    await withdrawAccount(withdrawSteps(step));

    assert.equal(calls.at(-1), 'local', failing);
    assert.equal(calls.length, 8, failing);
  }
});

test('account.withdraw: 탈퇴 뒤에는 마지막 로그인 제공자 기억도 남기지 않는다', async () => {
  const { calls, step } = recorder();

  await withdrawAccount(withdrawSteps(step));

  assert.ok(calls.includes('lastProvider'));
});
