import assert from 'node:assert/strict';
import test from 'node:test';

// Meta SDK·ATT 네이티브 모듈만 가짜로 두고 초기화 순서(ATT → initializeSDK → 추적 허용 여부)와 전송 게이트를 그대로 돈다.
// API URL 은 모듈을 불러올 때 읽으므로 경우마다 새 인스턴스를 불러온다.
const native = {};
function resetNative({ tracking = { status: 'granted' }, trackingMissing = false, sdkMissing = false, logThrows = false } = {}) {
  Object.assign(native, { tracking, trackingMissing, sdkMissing, logThrows, calls: [] });
}
globalThis.require = (name) => {
  if (name === 'expo-tracking-transparency') {
    if (native.trackingMissing) throw new Error(`Cannot find module '${name}'`);
    return {
      requestTrackingPermissionsAsync: async () => {
        native.calls.push('att');
        return native.tracking;
      },
    };
  }
  if (name === 'react-native-fbsdk-next') {
    if (native.sdkMissing) throw new Error(`Cannot find module '${name}'`);
    return {
      Settings: {
        initializeSDK: () => native.calls.push('initializeSDK'),
        setAdvertiserTrackingEnabled: async (enabled) => native.calls.push(`tracking ${enabled}`),
      },
      AppEventsLogger: {
        logEvent: (event) => {
          if (native.logThrows) throw new Error('native crash');
          native.calls.push(`event ${event}`);
        },
      },
    };
  }
  throw new Error(`unexpected require ${name}`);
};

let instance = 0;
async function load(apiUrl, override) {
  process.env.EXPO_PUBLIC_API_URL = apiUrl;
  if (override === undefined) delete process.env.EXPO_PUBLIC_META_EVENTS;
  else process.env.EXPO_PUBLIC_META_EVENTS = override;
  instance += 1;
  return import(`../lib/meta-events.ts?sdk=${instance}`);
}

test('운영 빌드: ATT 를 허용하면 SDK 를 붙이고 광고 추적을 켠 뒤 이벤트를 보낸다 — 두 번 불러도 한 번만 초기화한다', async () => {
  resetNative();
  const meta = await load('https://acttub.com');
  meta.logMetaEvent('before_init');
  await meta.initMetaSdk();
  await meta.initMetaSdk();
  meta.logMetaEvent('fb_mobile_complete_registration');
  assert.deepEqual(native.calls, ['att', 'initializeSDK', 'tracking true', 'event fb_mobile_complete_registration']);
});

test('운영 빌드: ATT 를 거절하면 광고 추적 없이 SDK 를 붙인다', async () => {
  resetNative({ tracking: { status: 'denied' } });
  const meta = await load('https://acttub.com');
  await meta.initMetaSdk();
  assert.deepEqual(native.calls, ['att', 'initializeSDK', 'tracking false']);
});

test('운영 빌드: ATT 모듈이 없거나 답이 비어도 광고 추적 없이 SDK 를 붙인다', async () => {
  resetNative({ trackingMissing: true });
  await (await load('https://acttub.com')).initMetaSdk();
  assert.deepEqual(native.calls, ['initializeSDK', 'tracking false']);

  resetNative({ tracking: null });
  await (await load('https://acttub.com')).initMetaSdk();
  assert.deepEqual(native.calls, ['att', 'initializeSDK', 'tracking false']);
});

test('dev 빌드라도 EXPO_PUBLIC_META_EVENTS=1 이면 SDK 를 붙여 이벤트를 보낸다(검증용 탈출구)', async () => {
  resetNative();
  const meta = await load('https://dev.acttub.com', '1');
  await meta.initMetaSdk();
  meta.logMetaEvent('practice_analysis_complete');
  assert.deepEqual(native.calls, ['att', 'initializeSDK', 'tracking true', 'event practice_analysis_complete']);
});

test('dev 빌드는 ATT 도 묻지 않고 SDK 도 붙이지 않는다', async () => {
  resetNative();
  const meta = await load('https://dev.acttub.com');
  await meta.initMetaSdk();
  meta.logMetaEvent('practice_analysis_complete');
  assert.deepEqual(native.calls, []);
});

test('SDK 모듈이 없으면 초기화되지 않아 이벤트를 보내지 않고, 보내다 네이티브가 던져도 앱은 계속된다', async () => {
  resetNative({ sdkMissing: true });
  const missing = await load('https://acttub.com');
  await missing.initMetaSdk();
  native.sdkMissing = false;
  missing.logMetaEvent('after_missing_sdk');
  assert.deepEqual(native.calls, ['att']);

  resetNative({ logThrows: true });
  const throwing = await load('https://acttub.com');
  await throwing.initMetaSdk();
  assert.doesNotThrow(() => throwing.logMetaEvent('practice_analysis_complete'));
  assert.deepEqual(native.calls, ['att', 'initializeSDK', 'tracking true']);
});
