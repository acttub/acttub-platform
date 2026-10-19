import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

// 0.0.4 이하 빌드처럼 expo-notifications·expo-device 가 없는 앱. 알림은 최선 노력이라 아무 일도 하지 않아야 한다.
const state = { storage: memoryStorage(), calls: [] };
globalThis.__notificationsMissing = state;
globalThis.require = name => { throw new Error(`Cannot find module '${name}'`); };

stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__notificationsMissing.storage;',
  'react-native': 'export const Platform = { OS: "ios" }; export const Linking = { openSettings: async () => undefined };',
  './api': `const s = globalThis.__notificationsMissing;
    export const api = {
      notificationSettings: async () => { s.calls.push('GET settings'); return { analysis_done: true, challenge: true, evening_reminder: true }; },
      updateNotificationSettings: async patch => { s.calls.push('PATCH settings'); return { analysis_done: true, challenge: true, evening_reminder: true, ...patch }; },
      registerPushToken: async () => { s.calls.push('register'); },
      unregisterPushToken: async () => { s.calls.push('unregister'); },
    };`,
});

const n = await import('../lib/notifications.ts');

test('모듈이 없으면 구독도 등록도 권한 확인도 하지 않는다', async () => {
  n.configureNotificationHandling();
  const stop = [n.onPushReceived(() => undefined), n.onPushTapped(() => undefined)];
  stop.forEach(fn => fn());
  state.storage.values.set('acttub.push.nudgeIds', '["n1"]');

  await n.syncNotificationsAfterGate();
  const toggle = await n.setNotificationToggle(
    { analysis_done: false, challenge: false, evening_reminder: false }, 'challenge', true,
  );
  await n.cancelReminders();

  assert.deepEqual(state.calls, ['GET settings', 'PATCH settings']);
  assert.equal(toggle.kind, 'saved');
  assert.equal(state.storage.values.get('acttub.push.nudgeIds'), '["n1"]');
});
