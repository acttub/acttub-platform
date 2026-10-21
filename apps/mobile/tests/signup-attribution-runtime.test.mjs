import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/stub-modules.mjs';

// 저장소·OS·분석·서버·Airbridge SDK 만 바꾼다. 귀속·기기 ID 추적 규칙(signup-attribution, airbridge-device)은 그대로 돈다.
mock.timers.enable({ apis: ['setTimeout'] });
const { ApiError } = await import('../lib/api-request.ts');
const UUID = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
const state = {
  ApiError,
  storage: memoryStorage(),
  appState: [],
  events: [],
  sent: [],
  devices: [],
  sendError: null,
  deviceError: null,
  sdk: true,
  sdkCalls: [],
  attributionCallback: null,
  device: 'success',
};
globalThis.__attribution = state;
globalThis.require = name => {
  assert.equal(name, 'airbridge-react-native-sdk');
  if (!state.sdk) throw new Error('native module missing');
  return {
    AirbridgeCategory: { SIGN_UP: 'airbridge.user.signup' },
    Airbridge: {
      setOnAttributionReceived: fn => { state.attributionCallback = fn; },
      setUserID: id => state.sdkCalls.push(['setUserID', id]),
      clearUser: () => state.sdkCalls.push(['clearUser']),
      trackEvent: category => state.sdkCalls.push(['trackEvent', category]),
      fetchDeviceUUID: async (onSuccess, onFailure) => {
        if (state.device === 'success') onSuccess(UUID);
        else if (state.device === 'failure') onFailure(new Error('no id'));
        else if (state.device === 'reject') throw new Error('sdk broken');
        return true;
      },
    },
  };
};

stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__attribution.storage;',
  'react-native': `const s = globalThis.__attribution;
    export const Platform = { OS: 'ios' };
    export const AppState = { addEventListener: (name, fn) => { s.appState.push(fn); return { remove() {} }; } };`,
  '@/lib/analytics': 'export const logEvent = async (name, params) => { globalThis.__attribution.events.push([name, params]); };',
  '@/lib/api': `const s = globalThis.__attribution;
    export const ApiError = s.ApiError;
    export const api = {
      recordSignupAttribution: async payload => { if (s.sendError) throw s.sendError; s.sent.push(payload); },
      recordAirbridgeDevice: async payload => { if (s.deviceError) throw s.deviceError; s.devices.push(payload); },
    };`,
});

const runtime = await import('../lib/signup-attribution-runtime.ts');

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const stored = key => JSON.parse(state.storage.values.get(key) ?? 'null');
const ATTRIBUTION_KEY = 'acttub.signupAttribution.v1';
const DEVICE_KEY = 'acttub.airbridgeDevice.v1';
const reset = () => {
  state.storage.values.clear();
  Object.assign(state, { events: [], sent: [], devices: [], sendError: null, deviceError: null, sdk: true, sdkCalls: [], device: 'success' });
};

test('귀속 결과를 받으면 기기에 적고, 가입한 계정이 확인되면 한 번 보낸다', async () => {
  reset();
  runtime.startSignupAttributionListener();
  runtime.startSignupAttributionListener();
  assert.equal(state.appState.length, 1, 'listens once per run');

  state.attributionCallback({ attributedChannel: '' });
  state.attributionCallback({ attributedChannel: 'instagram', attributedCampaign: 'fall' });
  await settle();

  assert.deepEqual(stored(ATTRIBUTION_KEY).attribution, { source: 'airbridge', platform: 'ios', channel: 'instagram', campaign: 'fall' });
  assert.deepEqual(state.events, [['signup_attribution', { stage: 'received', platform: 'ios', attributed: true, after_signup: false }]]);
  assert.equal(await runtime.readAttributedChannel(), 'instagram');

  runtime.recordSignupCompleted('member-1');
  await settle();

  assert.deepEqual(state.sdkCalls, [['setUserID', 'member-1'], ['trackEvent', 'airbridge.user.signup']]);
  assert.deepEqual(state.sent, [{ source: 'airbridge', platform: 'ios', channel: 'instagram', campaign: 'fall' }]);
  assert.equal(stored(ATTRIBUTION_KEY).sent, true);
  assert.deepEqual(state.devices, [{ platform: 'ios', device_uuid: UUID }]);
  assert.equal(stored(DEVICE_KEY).done, true);
  assert.deepEqual(state.events.slice(1), [
    ['signup_attribution', { stage: 'signed_up', platform: 'ios', has_attribution: true }],
    ['signup_attribution', { stage: 'sent', platform: 'ios' }],
  ]);
});

test('보내다 실패하면 15초 뒤 같은 실행 안에서 다시 보낸다', async () => {
  reset();
  state.sendError = new TypeError('offline');
  state.attributionCallback({ attributedChannel: 'youtube' });
  await settle();
  runtime.identifySignupAttributionAccount('member-2');
  runtime.recordSignupCompleted('member-2');
  await settle();

  assert.deepEqual(state.events.at(-1), ['signup_attribution', { stage: 'send_failed', platform: 'ios', error: 'network' }]);
  assert.equal(stored(ATTRIBUTION_KEY).sent, false);

  state.sendError = null;
  mock.timers.tick(15_000);
  await settle();

  assert.deepEqual(state.sent, [{ source: 'airbridge', platform: 'ios', channel: 'youtube' }]);
  assert.equal(stored(ATTRIBUTION_KEY).sent, true);
});

test('값 규칙 위반(422)은 다시 보내지 않고 거절로 센다', async () => {
  reset();
  state.sendError = new ApiError(422, 'bad', 'invalid');
  state.deviceError = new ApiError(422, 'bad', 'invalid');
  state.attributionCallback({ attributedChannel: 'unattributed' });
  runtime.recordSignupCompleted('member-3');
  await settle();

  assert.ok(state.events.some(([, params]) => params.stage === 'rejected'));
  assert.equal(stored(ATTRIBUTION_KEY).sent, true);
  assert.equal(stored(DEVICE_KEY).done, true);
  assert.deepEqual(state.events[0], ['signup_attribution', { stage: 'received', platform: 'ios', attributed: false, after_signup: false }]);
});

test('기기 ID 전송이 서버 오류로 실패하면 남겨 두었다가 앱이 앞으로 올 때 다시 보낸다', async () => {
  reset();
  state.deviceError = new ApiError(503, 'down');
  runtime.recordSignupCompleted('member-4');
  await settle();
  assert.equal(stored(DEVICE_KEY).done, false);

  state.deviceError = null;
  state.appState[0]('background');
  await settle();
  assert.deepEqual(state.devices, []);

  state.appState[0]('active');
  await settle();
  assert.deepEqual(state.devices, [{ platform: 'ios', device_uuid: UUID }]);
});

test('SDK 가 기기 ID 를 못 주거나 응답이 없으면 못 읽은 것으로 센다', async () => {
  for (const device of ['failure', 'reject']) {
    reset();
    state.device = device;
    runtime.recordSignupCompleted(`member-${device}`);
    await settle();
    assert.equal(stored(DEVICE_KEY).fetchFailures, 1, device);
    assert.deepEqual(state.devices, []);
  }

  reset();
  state.device = 'silent';
  runtime.recordSignupCompleted('member-silent');
  await settle();
  mock.timers.tick(10_000);
  await settle();
  assert.equal(stored(DEVICE_KEY).fetchFailures, 1);
});

test('SDK 가 없는 빌드에서는 SDK 를 부르지 않고 기기 ID 도 못 읽은 것으로 센다', async () => {
  reset();
  state.sdk = false;
  runtime.recordSignupCompleted('member-5');
  runtime.identifySignupAttributionAccount('member-5');
  await settle();
  assert.deepEqual(state.sdkCalls, []);
  assert.equal(stored(DEVICE_KEY).fetchFailures, 2, 'signup and account check each tried once');
});

test('로그아웃하면 Airbridge 사용자 정보를 지운다', async () => {
  reset();
  runtime.identifySignupAttributionAccount(null);
  await settle();
  assert.deepEqual(state.sdkCalls, [['clearUser']]);
});

test('귀속 채널은 아직 없거나 읽지 못하면 null 이다', async () => {
  reset();
  assert.equal(await runtime.readAttributedChannel(), null);
  const original = state.storage.getItem;
  state.storage.getItem = async () => { throw new Error('io'); };
  try {
    assert.equal(await runtime.readAttributedChannel(), null);
  } finally {
    state.storage.getItem = original;
  }
});
