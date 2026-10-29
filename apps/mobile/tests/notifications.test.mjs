import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/stub-modules.mjs';

// expo-notifications·expo-device·서버 API·OS 만 바꾸고 알림 동기화·토큰 생애 규칙은 그대로 돈다.
const state = {
  storage: memoryStorage(),
  os: 'ios',
  isDevice: true,
  permission: { granted: true, canAskAgain: true },
  requestGrants: true,
  token: 'ExponentPushToken[abc]',
  server: { analysis_done: true, challenge: true, evening_reminder: true },
  calls: [],
  handler: null,
  listeners: {},
  openedSettings: 0,
  unregisterFails: false,
};
globalThis.__notifications = state;
const notificationsModule = {
  setNotificationHandler: handler => { state.handler = handler; },
  addNotificationReceivedListener: fn => { state.listeners.received = fn; return { remove: () => { delete state.listeners.received; } }; },
  addNotificationResponseReceivedListener: fn => { state.listeners.tapped = fn; return { remove: () => { delete state.listeners.tapped; } }; },
  getPermissionsAsync: async () => state.permission,
  requestPermissionsAsync: async () => { state.calls.push(['requestPermission']); return { granted: state.requestGrants, canAskAgain: false }; },
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: async (id) => { state.calls.push(['channel', id]); },
  getExpoPushTokenAsync: async () => ({ data: state.token }),
  cancelAllScheduledNotificationsAsync: async () => { state.calls.push(['cancelAll']); },
};
globalThis.require = name => {
  if (name === 'expo-notifications') return notificationsModule;
  if (name === 'expo-device') return { get isDevice() { return state.isDevice; } };
  throw new Error(`unexpected require ${name}`);
};

stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__notifications.storage;',
  'react-native': `const s = globalThis.__notifications;
    export const Platform = { get OS() { return s.os; } };
    export const Linking = { openSettings: async () => { s.openedSettings += 1; } };`,
  './api': `const s = globalThis.__notifications;
    export const api = {
      notificationSettings: async () => { s.calls.push(['GET settings']); if (s.settingsFail) throw new Error('offline'); return { ...s.server }; },
      updateNotificationSettings: async patch => { s.calls.push(['PATCH settings', patch]); Object.assign(s.server, patch); return { ...s.server }; },
      registerPushToken: async (token, platform) => { s.calls.push(['register', token, platform]); },
      unregisterPushToken: async token => { s.calls.push(['unregister', token]); if (s.unregisterFails) throw new Error('offline'); },
    };`,
});

const n = await import('../lib/notifications.ts');

const ALL_ON = { analysis_done: true, challenge: true, evening_reminder: true };
const ALL_OFF = { analysis_done: false, challenge: false, evening_reminder: false };
const stored = key => state.storage.values.get(key) ?? null;

beforeEach(async () => {
  await n.cancelReminders();
  state.storage.values.clear();
  Object.assign(state, {
    os: 'ios', isDevice: true, permission: { granted: true, canAskAgain: true }, requestGrants: true,
    token: 'ExponentPushToken[abc]', server: { ...ALL_ON }, calls: [], settingsFail: false, unregisterFails: false,
  });
});

test('앱이 떠 있을 때도 알림은 배너와 목록으로 보여 주고 소리는 내지 않는다', async () => {
  n.configureNotificationHandling();
  assert.deepEqual(await state.handler.handleNotification({ request: { content: { data: { kind: 'analysis_complete', practice_id: 'p1' } } } }), {
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  });
  assert.equal((await state.handler.handleNotification()).shouldShowBanner, true);
});

test('보고 있는 화면이 숨기라고 건 알림만 숨기고, 풀면 다시 띄운다', async () => {
  n.configureNotificationHandling();
  const mine = { request: { content: { data: { kind: 'analysis_complete', practice_id: 'p1' } } } };
  const other = { request: { content: { data: { kind: 'analysis_complete', practice_id: 'p2' } } } };
  const release = n.hideForegroundPush((data) => data?.practice_id === 'p1');
  assert.deepEqual(await state.handler.handleNotification(mine), {
    shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
  });
  assert.equal((await state.handler.handleNotification(other)).shouldShowBanner, true);
  release();
  assert.equal((await state.handler.handleNotification(mine)).shouldShowBanner, true);
});

test('숨김 조건이 오류를 내도 알림은 띄운다', async () => {
  n.configureNotificationHandling();
  const release = n.hideForegroundPush(() => { throw new Error('boom'); });
  assert.equal((await state.handler.handleNotification({ request: { content: { data: {} } } })).shouldShowBanner, true);
  release();
});

test('받은 푸시와 누른 푸시의 자료를 넘기고, 끊으면 더 듣지 않는다', () => {
  const received = [];
  const tapped = [];
  const stopReceived = n.onPushReceived(data => received.push(data));
  const stopTapped = n.onPushTapped(data => tapped.push(data));

  state.listeners.received({ request: { content: { data: { kind: 'analysis_done', id: 'p1' } } } });
  state.listeners.received(undefined);
  state.listeners.tapped({ notification: { request: { content: { data: { kind: 'challenge' } } } } });
  state.listeners.tapped({});
  assert.deepEqual(received, [{ kind: 'analysis_done', id: 'p1' }, null]);
  assert.deepEqual(tapped, [{ kind: 'challenge' }, null]);

  stopReceived();
  stopTapped();
  assert.deepEqual(state.listeners, {});
});

test('게이트를 지나면 서버 토글을 읽어 기기에 적고 이 폰의 토큰을 등록한 뒤 옛 리마인드를 걷는다', async () => {
  state.storage.values.set('acttub.push.nudgeIds', '["n1"]');
  await n.syncNotificationsAfterGate();

  assert.deepEqual(state.calls, [
    ['GET settings'],
    ['register', 'ExponentPushToken[abc]', 'ios'],
    ['cancelAll'],
  ]);
  assert.deepEqual(JSON.parse(stored('acttub.push.settings')), ALL_ON);
  assert.equal(stored('acttub.push.token'), 'ExponentPushToken[abc]');
  assert.equal(stored('acttub.push.nudgeIds'), null);
});

test('예전 기기에서 알림을 꺼 둔 선택은 서버로 한 번 옮기고 지운다', async () => {
  state.storage.values.set('acttub.push.enabled', 'false');
  await n.syncNotificationsAfterGate();

  assert.deepEqual(state.calls[0], ['PATCH settings', ALL_OFF]);
  assert.equal(stored('acttub.push.enabled'), null);
  assert.ok(!state.calls.some(([name]) => name === 'register'), 'all toggles off → no registration');
});

test('서버를 못 읽으면 기기에 적어 둔 마지막 값으로 맞춘다', async () => {
  state.settingsFail = true;
  state.storage.values.set('acttub.push.settings', JSON.stringify(ALL_OFF));
  state.storage.values.set('acttub.push.token', 'old-token');

  await n.syncNotificationsAfterGate();

  assert.equal(stored('acttub.push.token'), null);
  assert.ok(!state.calls.some(([name]) => name === 'register'));
});

test('서버도 기기 기록도 읽지 못하면 기본값(모두 켜짐)으로 등록한다', async () => {
  state.settingsFail = true;
  const original = state.storage.getItem;
  state.storage.getItem = async key => { if (key === 'acttub.push.settings') throw new Error('io'); return original(key); };
  try {
    await n.syncNotificationsAfterGate();
  } finally {
    state.storage.getItem = original;
  }
  assert.ok(state.calls.some(([name]) => name === 'register'));
});

test('시뮬레이터·웹·권한 거부·토큰 없음이면 등록하지 않는다', async () => {
  for (const setup of [
    () => { state.isDevice = false; },
    () => { state.os = 'web'; },
    () => { state.permission = { granted: false, canAskAgain: false }; },
    () => { state.permission = { granted: false, canAskAgain: true }; state.requestGrants = false; },
    () => { state.token = ''; },
  ]) {
    await n.cancelReminders();
    state.calls = [];
    Object.assign(state, { isDevice: true, os: 'ios', permission: { granted: true, canAskAgain: true }, requestGrants: true, token: 'tok' });
    setup();
    await n.syncNotificationsAfterGate();
    assert.ok(!state.calls.some(([name]) => name === 'register'), JSON.stringify(state.calls));
  }
});

test('안드로이드는 권한을 묻기 전에 알림 채널부터 만들고(13+ 필수), 허락하면 등록한다', async () => {
  state.permission = { granted: false, canAskAgain: true };
  state.os = 'android';
  await n.syncNotificationsAfterGate();
  assert.deepEqual(state.calls.slice(0, 4), [['GET settings'], ['channel', 'default'], ['requestPermission'], ['register', 'ExponentPushToken[abc]', 'android']]);
});

test('토큰을 받다가 실패해도 조용히 끝낸다', async () => {
  const original = notificationsModule.getExpoPushTokenAsync;
  notificationsModule.getExpoPushTokenAsync = async () => { throw new Error('no fcm'); };
  try {
    await n.syncNotificationsAfterGate();
  } finally {
    notificationsModule.getExpoPushTokenAsync = original;
  }
  assert.deepEqual(state.calls, [['GET settings'], ['cancelAll']]);
});

test('배경에서 돌아오면 밀린 토큰 삭제를 다시 보내고, 게이트 전이면 거기서 멈춘다', async () => {
  state.storage.values.set('device.pendingPushTokenDeletions', JSON.stringify(['stale']));
  await n.syncNotificationsOnForeground(false);
  assert.deepEqual(state.calls, [['unregister', 'stale']]);
  assert.equal(stored('device.pendingPushTokenDeletions'), null);
});

test('앱을 켤 때 밀린 토큰 삭제를 보내고, 실패한 것은 남겨 둔다', async () => {
  state.unregisterFails = true;
  state.storage.values.set('device.pendingPushTokenDeletions', JSON.stringify(['t1']));
  await n.flushPendingPushTokenDeletions();
  assert.deepEqual(JSON.parse(stored('device.pendingPushTokenDeletions')), ['t1']);
});

test('토글을 켤 때 권한이 없으면 묻고, 거절하면 막혔다고 알린다', async () => {
  state.server = { ...ALL_OFF };
  state.permission = { granted: false, canAskAgain: true };
  state.requestGrants = false;

  const result = await n.setNotificationToggle(ALL_OFF, 'challenge', true);

  assert.deepEqual(result, { kind: 'permission_blocked', settings: { ...ALL_OFF, challenge: true } });
  assert.deepEqual(JSON.parse(stored('acttub.push.settings')), { ...ALL_OFF, challenge: true });
});

test('다시 물을 수 없는 권한이면 묻지 않고 막혔다고 알린다', async () => {
  state.permission = { granted: false, canAskAgain: false };
  const result = await n.setNotificationToggle(ALL_ON, 'analysis_done', true);
  assert.equal(result.kind, 'permission_blocked');
  assert.ok(!state.calls.some(([name]) => name === 'requestPermission'));
});

test('게이트를 지난 계정이 모두 꺼 둔 알림 하나를 켜면 이 폰의 토큰을 다시 등록한다', async () => {
  state.server = { ...ALL_OFF };
  await n.syncNotificationsAfterGate();
  state.calls = [];
  const result = await n.setNotificationToggle(ALL_OFF, 'evening_reminder', true);
  assert.deepEqual(result, { kind: 'saved', settings: { ...ALL_OFF, evening_reminder: true } });
  assert.deepEqual(state.calls, [['PATCH settings', { evening_reminder: true }], ['register', 'ExponentPushToken[abc]', 'ios']]);
});

test('마지막 하나를 끄면 토큰 기록을 버린다', async () => {
  state.server = { ...ALL_OFF, challenge: true };
  state.storage.values.set('acttub.push.token', 'tok');
  const result = await n.setNotificationToggle({ ...ALL_OFF, challenge: true }, 'challenge', false);
  assert.equal(result.kind, 'saved');
  assert.equal(stored('acttub.push.token'), null);
});

test('OS 알림 설정을 연다', async () => {
  const before = state.openedSettings;
  await n.openNotificationPermissionSettings();
  assert.equal(state.openedSettings, before + 1);
});

test('로그아웃은 서버에서 토큰을 지우고, 실패하면 다음에 다시 보내려고 적어 둔다', async () => {
  state.storage.values.set('acttub.push.token', 'tok-1');
  state.unregisterFails = true;
  await n.detachPushToken();
  assert.equal(stored('acttub.push.token'), null);
  assert.deepEqual(JSON.parse(stored('device.pendingPushTokenDeletions')), ['tok-1']);
});

test('탈퇴 뒤에는 서버를 부르지 않고 기기 기록만 버린다', async () => {
  state.storage.values.set('acttub.push.token', 'tok-2');
  await n.forgetPushToken();
  assert.equal(stored('acttub.push.token'), null);
  assert.deepEqual(state.calls, []);
});

test('계정이 떠나면 진행 중인 동기화는 토큰을 등록하지 않는다', async () => {
  let release;
  const original = notificationsModule.getPermissionsAsync;
  notificationsModule.getPermissionsAsync = () => new Promise(resolve => { release = () => resolve({ granted: true, canAskAgain: true }); });
  try {
    const sync = n.syncNotificationsAfterGate();
    await new Promise(resolve => setImmediate(resolve));
    await n.cancelReminders();
    release();
    await sync;
  } finally {
    notificationsModule.getPermissionsAsync = original;
  }
  assert.ok(!state.calls.some(([name]) => name === 'register'));
});

test('기기에 적는 일이 실패해도 토글 저장은 끝난다', async () => {
  const original = state.storage.setItem;
  state.storage.setItem = async () => { throw new Error('disk full'); };
  try {
    const result = await n.setNotificationToggle(ALL_ON, 'challenge', false);
    assert.deepEqual(result, { kind: 'saved', settings: { ...ALL_ON, challenge: false } });
  } finally {
    state.storage.setItem = original;
  }
});

test('계정이 떠난 뒤 저장된 토글은 토큰을 다시 등록하지 않는다', async () => {
  state.server = { ...ALL_OFF };
  const result = await n.setNotificationToggle(ALL_OFF, 'evening_reminder', true);
  assert.equal(result.kind, 'saved');
  assert.deepEqual(state.calls, [['PATCH settings', { evening_reminder: true }]]);
});
