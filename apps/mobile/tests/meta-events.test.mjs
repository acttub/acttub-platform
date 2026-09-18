import assert from 'node:assert/strict';
import test from 'node:test';

// Meta App Events 게이트(SOMA-481) — 개발 빌드가 설치 광고 데이터를 오염시키지 않는지 잠근다.
import {
  metaEventsEnabled,
  resolveTrackingDecision,
} from '../lib/meta-events.ts';

test('운영 API를 보는 빌드에서만 Meta 이벤트를 보낸다', () => {
  assert.equal(metaEventsEnabled('https://acttub.com', undefined), true);
  assert.equal(metaEventsEnabled('https://dev.acttub.com', undefined), false);
});

test('운영 URL 표기 흔들림(끝 슬래시·대문자·공백)은 같은 것으로 본다', () => {
  assert.equal(metaEventsEnabled('https://acttub.com/', undefined), true);
  assert.equal(metaEventsEnabled('  https://ACTTUB.com  ', undefined), true);
});

test('API URL이 없으면 dev로 보고 보내지 않는다', () => {
  assert.equal(metaEventsEnabled(undefined, undefined), false);
  assert.equal(metaEventsEnabled('', undefined), false);
});

test('EXPO_PUBLIC_META_EVENTS=1은 dev 빌드에서도 전송을 연다(검증용 탈출구)', () => {
  assert.equal(metaEventsEnabled('https://dev.acttub.com', '1'), true);
  assert.equal(metaEventsEnabled('https://dev.acttub.com', '0'), false);
  assert.equal(metaEventsEnabled('https://dev.acttub.com', 'true'), false);
});

test('게이트가 닫혀 있으면 SDK 자체를 초기화하지 않는다', () => {
  assert.deepEqual(resolveTrackingDecision({ enabled: false, granted: true }), {
    initialize: false,
    advertiserTracking: false,
  });
});

test('ATT를 거부하면 초기화는 하되 광고 식별자는 수집하지 않는다', () => {
  assert.deepEqual(resolveTrackingDecision({ enabled: true, granted: false }), {
    initialize: true,
    advertiserTracking: false,
  });
});

test('ATT 허용 시에만 광고 식별자를 수집한다', () => {
  assert.deepEqual(resolveTrackingDecision({ enabled: true, granted: true }), {
    initialize: true,
    advertiserTracking: true,
  });
});

async function loadMetaEvents(apiUrl) {
  const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const previousOverride = process.env.EXPO_PUBLIC_META_EVENTS;
  try {
    process.env.EXPO_PUBLIC_API_URL = apiUrl;
    process.env.EXPO_PUBLIC_META_EVENTS = '0';
    return await import(`../lib/meta-events.ts?apiUrl=${encodeURIComponent(apiUrl)}`);
  } finally {
    if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
    if (previousOverride === undefined) delete process.env.EXPO_PUBLIC_META_EVENTS;
    else process.env.EXPO_PUBLIC_META_EVENTS = previousOverride;
  }
}

test('게이트가 꺼진 환경에서는 Meta 이벤트 전송이 예외 없이 no-op이다', async () => {
  const { initMetaSdk, logMetaEvent } = await loadMetaEvents('https://dev.acttub.com');
  await initMetaSdk();
  assert.doesNotThrow(() => {
    assert.equal(logMetaEvent('fb_mobile_complete_registration'), undefined);
    assert.equal(logMetaEvent('practice_analysis_complete'), undefined);
  });
});

test('네이티브 모듈이 없어 SDK가 초기화되지 않아도 Meta 이벤트 전송은 예외가 없다', async () => {
  const { initMetaSdk, logMetaEvent } = await loadMetaEvents('https://acttub.com');
  assert.doesNotThrow(() => logMetaEvent('fb_mobile_complete_registration'));
  await assert.doesNotReject(() => initMetaSdk());
  assert.doesNotThrow(() => logMetaEvent('practice_analysis_complete'));
});
