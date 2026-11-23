import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

// 이 모듈은 AsyncStorage 를 늦게 require 한다. 그 자리에 메모리 저장소를 준다.
const storage = memoryStorage();
let requireFails = false;
globalThis.require = name => {
  assert.equal(name, '@react-native-async-storage/async-storage');
  if (requireFails) throw new Error('native module missing');
  return { default: storage };
};
const { mergePracticeDays, rememberPracticeDays, rememberSessionPracticeDay, sessionPracticeDays, subscribeSessionPracticeDays } = await import(
  '../lib/practice-days.ts'
);

const KEY = 'acttub.practiceDays.v2.u1';
const LEGACY = 'acttub.practiceDays.v1';
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

beforeEach(() => {
  storage.values.clear();
  requireFails = false;
});

test('새 날짜만 더하고 이미 있던 날짜와 깨진 시각은 그대로 둔다', () => {
  const stored = { '2026-10-1': at(2026, 10, 1, 9) };
  assert.deepEqual(
    mergePracticeDays(stored, [{ created_at: at(2026, 10, 1, 20) }, { created_at: at(2026, 10, 2) }, { created_at: 'not a date' }]),
    { '2026-10-1': at(2026, 10, 1, 9), '2026-10-2': at(2026, 10, 2) },
  );
});

test('서버 기록을 기기 누적분에 합쳐 저장하고, 지워진 날도 남겨 돌려준다', async () => {
  storage.values.set(KEY, JSON.stringify({ '2026-9-30': at(2026, 9, 30) }));

  const days = await rememberPracticeDays([{ created_at: at(2026, 10, 1) }], 'u1');

  assert.deepEqual(days, [{ created_at: at(2026, 9, 30) }, { created_at: at(2026, 10, 1) }]);
  assert.deepEqual(JSON.parse(storage.values.get(KEY)), { '2026-9-30': at(2026, 9, 30), '2026-10-1': at(2026, 10, 1) });
});

test('새 날짜가 없으면 다시 적지 않는다', async () => {
  storage.values.set(KEY, JSON.stringify({ '2026-10-1': at(2026, 10, 1) }));
  const writes = [];
  const original = storage.setItem;
  storage.setItem = async (...args) => { writes.push(args); };
  try {
    assert.deepEqual(await rememberPracticeDays([{ created_at: at(2026, 10, 1, 18) }], 'u1'), [{ created_at: at(2026, 10, 1) }]);
  } finally {
    storage.setItem = original;
  }
  assert.deepEqual(writes, []);
});

test('저장된 값이 깨졌거나 저장소가 없어도 서버 기록으로 그린다', async () => {
  storage.values.set(KEY, 'null');
  assert.deepEqual(await rememberPracticeDays([{ created_at: at(2026, 10, 3) }], 'u1'), [{ created_at: at(2026, 10, 3) }]);

  storage.values.set(KEY, '{broken');
  assert.deepEqual(await rememberPracticeDays([], 'u1'), []);

  requireFails = true;
  await assert.rejects(rememberPracticeDays([{ created_at: at(2026, 10, 4) }], 'u1'), /native module missing/);
});

test('적기가 실패해도 합친 결과를 돌려준다', async () => {
  const original = storage.setItem;
  storage.setItem = async () => { throw new Error('disk full'); };
  try {
    assert.deepEqual(await rememberPracticeDays([{ created_at: at(2026, 10, 5) }], 'u1'), [{ created_at: at(2026, 10, 5) }]);
  } finally {
    storage.setItem = original;
  }
});

test('계정별로 따로 쌓는다 — 같은 폰의 다른 계정은 앞 계정의 연습한 날을 이어받지 않는다(10/25)', async () => {
  await rememberPracticeDays([{ created_at: at(2026, 10, 1) }], 'u1');
  assert.deepEqual(await rememberPracticeDays([], 'u2'), []);
  assert.equal(storage.values.has('acttub.practiceDays.v2.u2'), false);
});

test('예전 기기 공용 값(v1)은 누구 것인지 몰라 쓰지 않고 지운다', async () => {
  storage.values.set(LEGACY, JSON.stringify({ '2026-9-30': at(2026, 9, 30) }));
  assert.deepEqual(await rememberPracticeDays([], 'u1'), []);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(storage.values.has(LEGACY), false);
});

test('계정을 아직 모르면 기기에 적지 않고 서버 기록만 돌려준다', async () => {
  assert.deepEqual(await rememberPracticeDays([{ created_at: at(2026, 10, 2) }], null), [{ created_at: at(2026, 10, 2) }]);
  assert.equal(storage.values.size, 0);
});

test('서버 연습일은 한국 시간 한낮 시각으로 바꾸고, 모양이 틀린 값은 버린다 (SOMA-1003)', async () => {
  const { serverPracticeDayRecords } = await import('../lib/practice-days.ts');
  assert.deepEqual(serverPracticeDayRecords(['2026-10-03', 'oops', '2026-10-5', '2026-11-02']), [
    { created_at: '2026-10-03T12:00:00+09:00' },
    { created_at: '2026-11-02T12:00:00+09:00' },
  ]);
});

// SOMA-1075 — 코칭 끝 화면이 적는 이번 실행의 연습한 날.
test('막 끝낸 코칭의 시작 시각은 계정별 메모리에만 두고, 기기 저장소에는 쓰지 않는다', async () => {
  const calls = [];
  const off = subscribeSessionPracticeDays(() => calls.push(sessionPracticeDays('s1')));
  const empty = sessionPracticeDays('s1');
  assert.deepEqual(empty, []);
  // 자정 전에 시작해 자정을 넘겨 끝낸 코칭 — 끝낸 날이 아니라 시작 시각 그대로 적는다(서버도 created_at 날로 센다).
  const started = '2026-10-31T14:50:00.000Z';
  rememberSessionPracticeDay(started, 's1');
  assert.deepEqual(sessionPracticeDays('s1'), [{ created_at: started }]);
  assert.equal(calls.length, 1);
  // 같은 회차를 다시 적으면 알리지 않고 같은 배열을 돌려준다(useSyncExternalStore 스냅샷).
  const snapshot = sessionPracticeDays('s1');
  rememberSessionPracticeDay(started, 's1');
  assert.equal(sessionPracticeDays('s1'), snapshot);
  assert.equal(calls.length, 1);
  // 계정·시각을 모르면 적지 않는다. 다른 계정에는 보이지 않는다.
  rememberSessionPracticeDay(started, null);
  rememberSessionPracticeDay('', 's1');
  rememberSessionPracticeDay('not a date', 's1');
  assert.equal(calls.length, 1);
  assert.deepEqual(sessionPracticeDays('s2'), []);
  assert.equal(storage.values.size, 0);
  off();
  rememberSessionPracticeDay('2026-10-28T03:00:00.000Z', 's1');
  assert.equal(calls.length, 1);
  assert.equal(sessionPracticeDays('s1').length, 2);
});
