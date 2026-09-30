import assert from 'node:assert/strict';
import test from 'node:test';

import { NUDGE_IDS_KEY, createReminderSchedule } from '../lib/reminder-schedule.ts';

const ALL_ON = { analysis_done: true, challenge: true, evening_reminder: true };
const REMINDER_OFF = { ...ALL_ON, evening_reminder: false };

function harness(initial = {}) {
  const map = new Map(Object.entries(initial));
  const live = new Set();
  let scheduled = 0;
  const scheduler = {
    /** n 번째 알람을 맞추는 순간에 끼어든다. 던지면 그 알람은 맞춰지지 않는다. */
    onSchedule: null,
    schedule: async () => {
      scheduler.onSchedule?.(scheduled + 1);
      scheduled += 1;
      const id = `alarm-${scheduled}`;
      live.add(id);
      return id;
    },
    cancel: async (id) => {
      live.delete(id);
    },
    cancelAll: async () => {
      live.clear();
    },
  };
  const reminders = createReminderSchedule({
    storage: {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
    },
    scheduler,
    now: () => new Date(2026, 8, 20, 9, 0, 0),
  });
  return { reminders, scheduler, live, map };
}

test('account.notification: 업데이트한 앱은 토글이 켜져 있어도 옛 로컬 리마인드를 취소만 한다', async () => {
  const { reminders, live } = harness();
  live.add('legacy-alarm');

  await reminders.sync(ALL_ON);

  assert.equal(live.size, 0);
});

test('account.notification: 리마인드 토글을 끄면 예약된 알람을 전부 취소한다', async () => {
  const { reminders, live } = harness();
  await reminders.sync(ALL_ON);

  await reminders.sync(REMINDER_OFF);

  assert.equal(live.size, 0);
});

test('account.logout: 맞추기와 취소가 겹쳐도 취소가 줄의 마지막에 끝나 예약된 알람은 0개다', async () => {
  const { reminders, live, map } = harness();
  let current = true;

  const syncing = reminders.sync(ALL_ON, () => current);
  // 로그아웃 — 계정 세대가 바뀌고 취소가 줄 뒤에 선다.
  current = false;
  const cancelling = reminders.cancelAll();
  await Promise.all([syncing, cancelling]);

  assert.equal(live.size, 0);
  assert.equal(map.has(NUDGE_IDS_KEY), false);
});

test('account.logout: 앱이 알람을 맞추다 죽어 예약 id 를 적지 못했어도 로그아웃 뒤 예약된 알람은 0개다', async () => {
  const { reminders, scheduler, live, map } = harness();
  // 앞선 실행이 남긴, id 를 모르는 알람.
  await scheduler.schedule(new Date());
  await scheduler.schedule(new Date());
  assert.equal(map.has(NUDGE_IDS_KEY), false);

  await reminders.cancelAll();

  assert.equal(live.size, 0);
});

test('account.logout: 예약 id 기록이 깨져 있어도 전부 취소한다', async () => {
  const { reminders, scheduler, live } = harness({ [NUDGE_IDS_KEY]: '깨진 값' });
  await scheduler.schedule(new Date());

  await reminders.cancelAll();

  assert.equal(live.size, 0);
});
