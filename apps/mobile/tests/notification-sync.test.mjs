import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FOREGROUND_SYNC_MIN_INTERVAL_MS,
  createNotificationSync,
} from '../lib/notification-sync.ts';

const ALL_ON = { analysis_done: true, challenge: true, evening_reminder: true };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness({ settings = ALL_ON } = {}) {
  const calls = [];
  const state = { clock: 0, pendingSettings: null, settingsGuards: [] };
  const sync = createNotificationSync({
    loadSettings: async (isCurrent) => {
      calls.push('settings');
      state.settingsGuards.push(isCurrent);
      return state.pendingSettings ? state.pendingSettings.promise : settings;
    },
    cachedSettings: async () => settings,
    registerDevice: async (options) => {
      calls.push(options?.askPermission === false ? 'register:quiet' : 'register:ask');
    },
    forgetToken: async () => {
      calls.push('forget');
    },
    flushPendingDeletions: async () => {
      calls.push('flush');
    },
    clearLocalReminders: async () => {
      calls.push('clear');
    },
    now: () => state.clock,
  });
  return { sync, calls, state };
}

test('account.logout: 알림 설정 조회가 늦어지는 사이 로그아웃하면 옛 로컬 리마인드를 취소하고 뒤늦게 재개된 동기화는 아무것도 하지 않는다', async () => {
  const { sync, calls, state } = harness();
  state.pendingSettings = deferred();

  const syncing = sync.afterGate();
  await sync.leave();
  state.pendingSettings.resolve(ALL_ON);
  await syncing;

  assert.deepEqual(calls, ['settings', 'clear']);
});

test('account.logout: 설정 조회가 세션이 끊겨 실패해도 기기에 적어 둔 값으로 동기화를 이어가지 않는다', async () => {
  const { sync, calls, state } = harness();
  state.pendingSettings = deferred();

  const syncing = sync.afterGate();
  await sync.leave();
  state.pendingSettings.reject(new Error('401'));
  await syncing;

  assert.deepEqual(calls, ['settings', 'clear']);
});

test('account.logout: 로그아웃이 시작된 뒤에는 옛 동기화가 이 폰의 푸시 토큰을 다시 등록하지 않는다', async () => {
  const { sync, calls, state } = harness();
  state.pendingSettings = deferred();

  const syncing = sync.afterGate();
  await sync.leave();
  state.pendingSettings.resolve(ALL_ON);
  await syncing;

  assert.deepEqual(
    calls.filter((call) => call.startsWith('register')),
    [],
  );
});

test('account.logout: 로그아웃 뒤에는 옛 계정의 알림 설정을 기기에 적지 않도록 설정 조회에 넘긴 확인이 거짓이 된다', async () => {
  const { sync, state } = harness();

  await sync.afterGate();
  const [isCurrent] = state.settingsGuards;
  assert.equal(isCurrent(), true);
  await sync.leave();

  assert.equal(isCurrent(), false);
});

test('account.notification: 게이트를 통과할 때마다 옛 판이 남긴 로컬 리마인드를 취소한다', async () => {
  const { sync, calls } = harness();

  await sync.afterGate();
  await sync.leave();
  await sync.afterGate();

  assert.deepEqual(calls, ['settings', 'register:ask', 'clear', 'clear', 'settings', 'register:ask', 'clear']);
});

test('account.notification: 앱이 배경에서 돌아오면 토큰을 다시 등록하고 로컬 리마인드는 비워 둔다', async () => {
  const { sync, calls, state } = harness();
  await sync.afterGate();
  calls.length = 0;
  state.clock += FOREGROUND_SYNC_MIN_INTERVAL_MS;
  await sync.onForeground({ gatePassed: true });

  // 배경 복귀 때는 알림 권한을 새로 묻지 않는다. 이미 허용한 폰만 다시 등록한다.
  assert.deepEqual(calls, ['flush', 'settings', 'register:quiet', 'clear']);
});

test('account.notification: 다른 기기에서 푸시 토글 둘을 껐다 켜 토큰이 지워졌어도 앱을 다시 열면 이 폰을 다시 등록한다', async () => {
  const { sync, calls, state } = harness();
  await sync.afterGate();

  state.clock += FOREGROUND_SYNC_MIN_INTERVAL_MS;
  await sync.onForeground({ gatePassed: true });

  assert.equal(calls.filter((call) => call.startsWith('register')).length, 2);
});

test('account.notification: 배경 복귀가 잦아도 최소 간격 안에서는 다시 맞추지 않는다', async () => {
  const { sync, calls, state } = harness();
  await sync.afterGate();
  calls.length = 0;

  state.clock += FOREGROUND_SYNC_MIN_INTERVAL_MS - 1;
  await sync.onForeground({ gatePassed: true });
  assert.deepEqual(calls, ['flush']);

  state.clock += 1;
  await sync.onForeground({ gatePassed: true });
  await sync.onForeground({ gatePassed: true });
  assert.deepEqual(calls, ['flush', 'flush', 'settings', 'register:quiet', 'clear', 'flush']);
});

test('account.notification: 게이트를 통과하지 않았으면 배경에서 돌아와도 밀린 토큰 삭제만 다시 보낸다', async () => {
  const { sync, calls } = harness();

  await sync.onForeground({ gatePassed: false });

  assert.deepEqual(calls, ['flush']);
});

test('account.logout: 로그아웃이 진행 중일 때 앱이 앞으로 돌아와도 동기화를 새로 시작하지 않는다', async () => {
  const { sync, calls, state } = harness();
  await sync.afterGate();
  await sync.leave();
  calls.length = 0;

  // 로그아웃의 마지막 단계(기기 토큰 삭제)가 끝나기 전이라 화면은 아직 게이트를 통과한 상태다.
  state.clock += FOREGROUND_SYNC_MIN_INTERVAL_MS;
  await sync.onForeground({ gatePassed: true });

  assert.deepEqual(calls, ['flush']);
});

test('account.notification: 토글이 쓰는 확인도 로그아웃 뒤에는 거짓이 되어 토큰을 다시 등록하지 않는다', async () => {
  const { sync } = harness();
  await sync.afterGate();
  const isCurrent = sync.guard();

  await sync.leave();

  assert.equal(isCurrent(), false);
});
