import assert from 'node:assert/strict';
import test from 'node:test';

// 가입 유입 광고(SOMA-588) — 새로 가입한 계정에만, 한 번만, 광고 식별자 없이 보내는지 잠근다.
import {
  EMPTY_SIGNUP_ATTRIBUTION_STATE,
  SIGNUP_ATTRIBUTION_STORAGE_KEY,
  createSignupAttributionTracker,
  parseSignupAttributionState,
  shouldSendSignupAttribution,
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
