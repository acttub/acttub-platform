import assert from 'node:assert/strict';
import test from 'node:test';

// 서버 재조회용 Airbridge 기기 ID(SOMA-643) — 가입한 계정에만, 한 번만, 쓸 수 있는 ID 일 때만 보내는지 잠근다.
import {
  AIRBRIDGE_DEVICE_MAX_AGE_MS,
  AIRBRIDGE_DEVICE_MAX_FETCH_FAILURES,
  AIRBRIDGE_DEVICE_STORAGE_KEY,
  createAirbridgeDeviceTracker,
  isUsableAirbridgeDeviceId,
  parseAirbridgeDeviceState,
} from '../lib/airbridge-device.ts';

const DEVICE = '11111111-2222-3333-4444-555555555555';

function memoryStorage() {
  const items = new Map();
  return {
    items,
    async getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
  };
}

function stored(storage) {
  return parseAirbridgeDeviceState(storage.items.get(AIRBRIDGE_DEVICE_STORAGE_KEY) ?? null);
}

function setup(overrides = {}) {
  const storage = memoryStorage();
  const sent = [];
  let clock = 1_000_000;
  const deps = {
    storage,
    fetchDevice: async () => DEVICE,
    send: async (payload) => {
      sent.push(payload);
    },
    platform: 'android',
    now: () => clock,
    ...overrides,
  };
  return { storage, sent, tracker: createAirbridgeDeviceTracker(deps), advance: (ms) => (clock += ms) };
}

test('쓸 수 있는 기기 ID 는 36자 UUID 이고 모두 0 이 아니다', () => {
  assert.equal(isUsableAirbridgeDeviceId(DEVICE), true);
  assert.equal(isUsableAirbridgeDeviceId(DEVICE.toUpperCase()), true);
  assert.equal(isUsableAirbridgeDeviceId('00000000-0000-0000-0000-000000000000'), false);
  assert.equal(isUsableAirbridgeDeviceId('abc'), false);
  assert.equal(isUsableAirbridgeDeviceId(null), false);
});

test('가입한 계정으로 로그인한 상태면 한 번 보내고, 기기 ID 는 저장하지 않는다', async () => {
  const { tracker, sent, storage } = setup();
  await tracker.signedUp('user-1');
  await tracker.accountResolved('user-1');
  await tracker.retry();
  assert.deepEqual(sent, [{ platform: 'android', device_uuid: DEVICE }]);
  assert.equal(stored(storage).done, true);
  assert.equal(storage.items.get(AIRBRIDGE_DEVICE_STORAGE_KEY).includes(DEVICE), false);
});

test('가입하지 않은 계정·다른 계정·로그아웃이면 보내지 않는다', async () => {
  const { tracker, sent } = setup();
  await tracker.accountResolved('existing-user');
  assert.deepEqual(sent, []);
  await tracker.signedUp('user-1');
  assert.equal(sent.length, 1);
  const second = setup();
  await second.tracker.signedUp('user-1');
  await second.tracker.accountResolved(null);
  await second.tracker.accountResolved('user-2');
  assert.equal(second.sent.length, 1); // 가입 직후 한 번 — 이후 다른 계정으론 더 보내지 않는다
});

test('전송이 실패하면 계정을 확인할 때·retry 때 다시 보낸다', async () => {
  let fail = true;
  let failedCallbacks = 0;
  const sent = [];
  const { tracker, storage } = setup({
    send: async (payload) => {
      if (fail) throw new Error('network');
      sent.push(payload);
    },
    onSendFailed: () => {
      failedCallbacks += 1;
    },
  });
  await tracker.signedUp('user-1');
  assert.equal(failedCallbacks, 1);
  assert.equal(stored(storage).done, false);
  fail = false;
  await tracker.retry();
  assert.equal(sent.length, 1);
  assert.equal(stored(storage).done, true);
});

test('기기 ID 를 못 읽거나 쓸 수 없으면 보내지 않고 한도까지만 다시 읽는다', async () => {
  let reads = 0;
  const { tracker, sent, storage } = setup({
    fetchDevice: async () => {
      reads += 1;
      return '00000000-0000-0000-0000-000000000000';
    },
  });
  await tracker.signedUp('user-1');
  for (let i = 0; i < 10; i += 1) await tracker.retry();
  assert.deepEqual(sent, []);
  assert.equal(reads, AIRBRIDGE_DEVICE_MAX_FETCH_FAILURES);
  assert.equal(stored(storage).fetchFailures, AIRBRIDGE_DEVICE_MAX_FETCH_FAILURES);
});

test('SDK 가 던지면 못 읽은 것으로 센다', async () => {
  const { tracker, sent, storage } = setup({
    fetchDevice: async () => {
      throw new Error('no native module');
    },
  });
  await tracker.signedUp('user-1');
  assert.deepEqual(sent, []);
  assert.equal(stored(storage).fetchFailures, 1);
});

test('가입 24시간이 지나면 보내지 않는다 — 서버가 이미 지운다', async () => {
  const { tracker, sent, advance } = setup({
    fetchDevice: async () => null,
  });
  await tracker.signedUp('user-1');
  advance(AIRBRIDGE_DEVICE_MAX_AGE_MS + 1);
  await tracker.retry();
  assert.deepEqual(sent, []);
});

test('값 규칙 위반(422)을 삼키면 끝난 것으로 적고 다시 보내지 않는다', async () => {
  let calls = 0;
  const { tracker, storage } = setup({
    send: async () => {
      calls += 1; // send 가 422 를 삼키고 정상 반환하는 경우
    },
  });
  await tracker.signedUp('user-1');
  await tracker.retry();
  assert.equal(calls, 1);
  assert.equal(stored(storage).done, true);
});

test('ios·android 가 아니면 아무것도 하지 않는다', async () => {
  const { tracker, sent } = setup({ platform: 'web' });
  await tracker.signedUp('user-1');
  assert.deepEqual(sent, []);
});

test('두 번째 계정이 같은 기기에서 가입해도 첫 가입 계정만 남는다', async () => {
  const { tracker, sent, storage } = setup({ send: async () => { throw new Error('x'); } });
  await tracker.signedUp('user-1');
  await tracker.signedUp('user-2');
  assert.equal(stored(storage).signupUserId, 'user-1');
  assert.deepEqual(sent, []);
});
