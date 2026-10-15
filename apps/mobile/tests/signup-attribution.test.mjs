import assert from 'node:assert/strict';
import test from 'node:test';

// 가입 유입 광고(SOMA-588) — 새로 가입한 계정에만, 한 번만, 광고 식별자 없이 보내는지 잠근다.
import {
  EMPTY_SIGNUP_ATTRIBUTION_STATE,
  SIGNUP_ATTRIBUTION_STORAGE_KEY,
  createSignupAttributionTracker,
  parseSignupAttributionState,
  shouldSendSignupAttribution,
  signupAttributionErrorCode,
  signupAttributionEventParams,
  signupAttributionRetryDelayMs,
  toSignupAttribution,
} from '../lib/signup-attribution.ts';

const META_INSTALL = {
  attributedChannel: 'facebook.business',
  attributedCampaign: 'ACTTUB | iOS 앱 설치 릴스',
  attributedAdGroup: 'iOS 앱 설치 | 연기',
  attributedAdCreative: '대사분석 릴스 | iOS 앱 설치',
  attributedContent: '',
  attributedSubSubPublisher1: 'ignored',
};

function memoryStorage(initial = null) {
  const items = new Map();
  if (initial !== null) items.set(SIGNUP_ATTRIBUTION_STORAGE_KEY, initial);
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
  return parseSignupAttributionState(storage.items.get(SIGNUP_ATTRIBUTION_STORAGE_KEY) ?? null);
}

test('Airbridge 귀속 결과를 서버 본문으로 옮긴다 — 빈 값과 모르는 키는 싣지 않는다', () => {
  assert.deepEqual(toSignupAttribution(META_INSTALL, 'ios'), {
    source: 'airbridge',
    platform: 'ios',
    channel: 'facebook.business',
    campaign: 'ACTTUB | iOS 앱 설치 릴스',
    ad_group: 'iOS 앱 설치 | 연기',
    ad_creative: '대사분석 릴스 | iOS 앱 설치',
  });
});

test('광고 없이 온 설치(unattributed)도 적는다', () => {
  assert.deepEqual(toSignupAttribution({ attributedChannel: 'unattributed' }, 'android'), {
    source: 'airbridge',
    platform: 'android',
    channel: 'unattributed',
  });
});

test('채널이 없거나 플랫폼이 앱이 아니면 보낼 것이 없다', () => {
  assert.equal(toSignupAttribution({ attributedCampaign: 'x' }, 'ios'), null);
  assert.equal(toSignupAttribution({ attributedChannel: '   ' }, 'ios'), null);
  assert.equal(toSignupAttribution(META_INSTALL, 'web'), null);
  assert.equal(toSignupAttribution(null, 'ios'), null);
});

test('200자를 넘는 값은 잘라서 보낸다(서버 한도와 같다)', () => {
  const payload = toSignupAttribution(
    { attributedChannel: 'facebook.business', attributedCampaign: '가'.repeat(250) },
    'ios',
  );
  assert.equal(Array.from(payload.campaign).length, 200);
});

test('가입을 마친 계정과 지금 계정이 같고, 귀속이 있고, 아직 안 보냈을 때만 보낸다', () => {
  const ready = {
    attribution: toSignupAttribution(META_INSTALL, 'ios'),
    signupUserId: 'u1',
    sent: false,
  };
  assert.equal(shouldSendSignupAttribution(ready, 'u1'), true);
  assert.equal(shouldSendSignupAttribution(ready, 'u2'), false);
  assert.equal(shouldSendSignupAttribution(ready, null), false);
  assert.equal(shouldSendSignupAttribution({ ...ready, sent: true }, 'u1'), false);
  assert.equal(shouldSendSignupAttribution({ ...ready, attribution: null }, 'u1'), false);
  assert.equal(shouldSendSignupAttribution({ ...ready, signupUserId: null }, 'u1'), false);
});

test('망가진 저장값은 빈 상태로 읽는다', () => {
  assert.deepEqual(parseSignupAttributionState('{not json'), EMPTY_SIGNUP_ATTRIBUTION_STATE);
  assert.deepEqual(parseSignupAttributionState(null), EMPTY_SIGNUP_ATTRIBUTION_STATE);
});

test('귀속이 먼저 오고 가입이 뒤에 와도 한 번만 보낸다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const tracker = createSignupAttributionTracker({ storage, send: async (p) => sent.push(p) });

  await tracker.received(toSignupAttribution(META_INSTALL, 'ios'));
  assert.equal(sent.length, 0, '가입 전에는 보내지 않는다');
  await tracker.signedUp('u1');
  await tracker.accountResolved('u1');
  await tracker.received(toSignupAttribution({ attributedChannel: 'unattributed' }, 'ios'));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'facebook.business');
  assert.equal(stored(storage).sent, true);
});

test('가입이 먼저고 귀속이 몇 분 뒤에 와도 그 계정으로 보낸다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const tracker = createSignupAttributionTracker({ storage, send: async (p) => sent.push(p) });

  await tracker.signedUp('u1');
  await tracker.received(toSignupAttribution(META_INSTALL, 'android'));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].platform, 'android');
});

test('기존 회원이 앱을 열기만 하면 보내지 않는다 — 이 기기에서 가입하지 않았다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const tracker = createSignupAttributionTracker({ storage, send: async (p) => sent.push(p) });

  await tracker.accountResolved('old-member');
  await tracker.received(toSignupAttribution(META_INSTALL, 'ios'));

  assert.equal(sent.length, 0);
});

test('로그아웃하고 다른 계정이 들어오면 그 계정에는 보내지 않는다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const tracker = createSignupAttributionTracker({ storage, send: async (p) => sent.push(p) });

  await tracker.accountResolved('u1');
  await tracker.accountResolved(null);
  await tracker.signedUp('u2');
  await tracker.accountResolved('u3');
  await tracker.received(toSignupAttribution(META_INSTALL, 'ios'));

  assert.equal(sent.length, 0, '가입한 u2 가 아닌 u3 로 로그인해 있다');
  await tracker.accountResolved('u2');
  assert.equal(sent.length, 1);
});

test('보내다 실패하면 보낸 것으로 적지 않고 다음 계정 확인 때 다시 보낸다', async () => {
  const storage = memoryStorage();
  let attempts = 0;
  const tracker = createSignupAttributionTracker({
    storage,
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
  });

  await tracker.received(toSignupAttribution(META_INSTALL, 'ios'));
  await tracker.signedUp('u1');
  assert.equal(stored(storage).sent, false);

  await tracker.accountResolved('u1');
  assert.equal(attempts, 2);
  assert.equal(stored(storage).sent, true);
});

test('앱을 다시 열어도(새 추적기) 저장해 둔 상태로 이어서 보낸다', async () => {
  const storage = memoryStorage();
  const first = createSignupAttributionTracker({ storage, send: async () => { throw new Error('offline'); } });
  await first.signedUp('u1');
  await first.received(toSignupAttribution(META_INSTALL, 'ios'));

  const sent = [];
  const second = createSignupAttributionTracker({ storage, send: async (p) => sent.push(p) });
  await second.accountResolved('u1');

  assert.equal(sent.length, 1);
});

// SOMA-643 — 가입 당일 한 번 쓰고 다시 열지 않는 사람이 많아, 다음 실행만 기다리면 기록이 빠진다.
test('보내다 실패하면 알리고, 같은 실행 안에서 retry() 로 다시 보낸다', async () => {
  const storage = memoryStorage();
  let attempts = 0;
  let failures = 0;
  const tracker = createSignupAttributionTracker({
    storage,
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
    onSendFailed: () => {
      failures += 1;
    },
  });

  await tracker.received(toSignupAttribution(META_INSTALL, 'android'));
  await tracker.signedUp('u1');
  assert.equal(failures, 1);
  assert.equal(stored(storage).sent, false);

  await tracker.retry();
  assert.equal(attempts, 2);
  assert.equal(stored(storage).sent, true);

  await tracker.retry();
  assert.equal(attempts, 2, '이미 보냈으면 다시 보내지 않는다');
});

test('retry() 는 가입하지 않은 계정이나 로그아웃 상태에서는 보내지 않는다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const tracker = createSignupAttributionTracker({ storage, send: async (p) => sent.push(p) });

  await tracker.received(toSignupAttribution(META_INSTALL, 'ios'));
  await tracker.retry();
  await tracker.accountResolved('old-member');
  await tracker.retry();
  assert.equal(sent.length, 0);
});

test('진단 신호는 단계 순서대로 한 번씩, 광고 이름·계정 번호 없이 나온다', async () => {
  const storage = memoryStorage();
  const reports = [];
  let attempts = 0;
  const tracker = createSignupAttributionTracker({
    storage,
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('forbidden'), { status: 403 });
    },
    report: (d) => reports.push(signupAttributionEventParams(d, 'android')),
  });

  await tracker.signedUp('u1');
  await tracker.received(toSignupAttribution(META_INSTALL, 'android'));
  await tracker.received(toSignupAttribution({ attributedChannel: 'unattributed' }, 'android'));
  await tracker.retry();

  assert.deepEqual(reports, [
    { stage: 'signed_up', platform: 'android', has_attribution: false },
    { stage: 'received', platform: 'android', attributed: true, after_signup: true },
    { stage: 'send_failed', platform: 'android', error: 'http_403' },
    { stage: 'sent', platform: 'android' },
  ]);
  const text = JSON.stringify(reports);
  assert.ok(!text.includes('u1') && !text.includes('facebook') && !text.includes('ACTTUB'));
});

test('진단 신호를 던지는 쪽이 고장 나도 전송은 이어진다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const tracker = createSignupAttributionTracker({
    storage,
    send: async (p) => sent.push(p),
    report: () => {
      throw new Error('analytics down');
    },
  });

  await tracker.received(toSignupAttribution(META_INSTALL, 'ios'));
  await tracker.signedUp('u1');
  assert.equal(sent.length, 1);
  assert.equal(stored(storage).sent, true);
});

test('같은 실행 안 재시도 간격은 15초·1분·3분, 그 뒤는 멈춘다', () => {
  assert.equal(signupAttributionRetryDelayMs(0), 15_000);
  assert.equal(signupAttributionRetryDelayMs(1), 60_000);
  assert.equal(signupAttributionRetryDelayMs(2), 180_000);
  assert.equal(signupAttributionRetryDelayMs(3), null);
});

test('실패 사유는 HTTP 상태 또는 network 로만 줄인다', () => {
  assert.equal(signupAttributionErrorCode(Object.assign(new Error('x'), { status: 401 })), 'http_401');
  assert.equal(signupAttributionErrorCode(new Error('Network request failed')), 'network');
  assert.equal(signupAttributionErrorCode(undefined), 'network');
});
