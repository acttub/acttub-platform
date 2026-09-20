import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FOREGROUND_SYNC_MIN_INTERVAL_MS,
  createNotificationSync,
} from '../lib/notification-sync.ts';
import { createReminderSchedule } from '../lib/reminder-schedule.ts';

const ALL_ON = { analysis_done: true, challenge: true, evening_reminder: true };

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 폰의 알람 목록. live 가 지금 예약돼 있는 알람이다. */
function fakeScheduler() {
  const live = new Set();
  let scheduled = 0;
  const scheduler = {
    live,
    /** n 번째 알람을 맞추는 순간에 끼어든다. */
    onSchedule: null,
    schedule: async () => {
      scheduled += 1;
      const id = `alarm-${scheduled}`;
      live.add(id);
      scheduler.onSchedule?.(scheduled);
      return id;
    },
    cancel: async (id) => {
      live.delete(id);
    },
    cancelAll: async () => {
      live.clear();
    },
  };
  return scheduler;
}

function harness({ settings = ALL_ON } = {}) {
  const scheduler = fakeScheduler();
  const reminders = createReminderSchedule({
    storage: memoryStorage(),
    scheduler,
    now: () => new Date(2026, 8, 20, 9, 0, 0),
  });
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
    reminders,
    now: () => state.clock,
  });
  return { sync, scheduler, reminders, calls, state };
}

test('account.logout: 알림 설정 조회가 늦어지는 사이 로그아웃하면 뒤늦게 재개된 동기화가 리마인드 알람을 다시 만들지 않는다', async () => {
  const { sync, scheduler, state } = harness();
  state.pendingSettings = deferred();

  const syncing = sync.afterGate();
  await sync.leave();
  state.pendingSettings.resolve(ALL_ON);
  await syncing;

  assert.equal(scheduler.live.size, 0);
});

test('account.logout: 설정 조회가 세션이 끊겨 실패해도 기기에 적어 둔 값으로 알람을 맞추지 않는다', async () => {
  const { sync, scheduler, state } = harness();
  state.pendingSettings = deferred();

  const syncing = sync.afterGate();
  await sync.leave();
  state.pendingSettings.reject(new Error('401'));
  await syncing;

  assert.equal(scheduler.live.size, 0);
});

test('account.logout: 30일치 알람을 맞추는 도중에 로그아웃해도 취소가 마지막에 끝나 예약된 알람은 0개다', async () => {
  const { sync, scheduler } = harness();
  let leaving = null;
  scheduler.onSchedule = (count) => {
    // 세 번째 알람을 맞추는 순간 로그아웃이 시작된다(기다리지 않는다 — 두 흐름이 겹친다).
    if (count === 3) leaving = sync.leave();
  };

  await sync.afterGate();
  await leaving;

  assert.ok(leaving, '로그아웃이 예약 도중에 시작되지 않았다');
  assert.equal(scheduler.live.size, 0);
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

test('account.logout: 다시 로그인해 게이트를 통과하면 30일치를 다시 맞춘다', async () => {
  const { sync, scheduler } = harness();

  await sync.afterGate();
  await sync.leave();
  assert.equal(scheduler.live.size, 0);
  await sync.afterGate();

  assert.equal(scheduler.live.size, 30);
});

test('account.notification: 앱이 배경에서 돌아오면 게이트를 통과한 계정의 밀린 삭제·알림 설정·토큰 등록·30일 리마인드를 다시 맞춘다', async () => {
  const { sync, scheduler, calls, state } = harness();
  await sync.afterGate();
  calls.length = 0;
  const before = [...scheduler.live];

  state.clock += FOREGROUND_SYNC_MIN_INTERVAL_MS;
  await sync.onForeground({ gatePassed: true });

  // 배경 복귀 때는 알림 권한을 새로 묻지 않는다. 이미 허용한 폰만 다시 등록한다.
  assert.deepEqual(calls, ['flush', 'settings', 'register:quiet']);
  assert.equal(scheduler.live.size, 30);
  assert.equal(before.some((id) => scheduler.live.has(id)), false, '30일치를 새로 맞추지 않았다');
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
  assert.deepEqual(calls, ['flush', 'flush', 'settings', 'register:quiet', 'flush']);
});

test('account.notification: 게이트를 통과하지 않았으면 배경에서 돌아와도 밀린 토큰 삭제만 다시 보낸다', async () => {
  const { sync, scheduler, calls } = harness();

  await sync.onForeground({ gatePassed: false });

  assert.deepEqual(calls, ['flush']);
  assert.equal(scheduler.live.size, 0);
});

test('account.logout: 로그아웃이 진행 중일 때 앱이 앞으로 돌아와도 동기화를 새로 시작하지 않는다', async () => {
  const { sync, scheduler, calls, state } = harness();
  await sync.afterGate();
  await sync.leave();
  calls.length = 0;

  // 로그아웃의 마지막 단계(기기 토큰 삭제)가 끝나기 전이라 화면은 아직 게이트를 통과한 상태다.
  state.clock += FOREGROUND_SYNC_MIN_INTERVAL_MS;
  await sync.onForeground({ gatePassed: true });

  assert.deepEqual(calls, ['flush']);
  assert.equal(scheduler.live.size, 0);
});

test('account.notification: 연습 완료와 토글이 쓰는 확인도 로그아웃 뒤에는 거짓이 되어 알람을 다시 맞추지 않는다', async () => {
  const { sync, scheduler, reminders } = harness();
  await sync.afterGate();
  const isCurrent = sync.guard();

  await sync.leave();
  await reminders.sync(ALL_ON, isCurrent);

  assert.equal(isCurrent(), false);
  assert.equal(scheduler.live.size, 0);
});
