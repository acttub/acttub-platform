import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AD_SLOTS,
  PRODUCTION_BANNER_UNITS,
  adRequestConfigFor,
  TEST_BANNER_UNIT,
  bannerUnitFor,
  confirmReward,
  isHttpLink,
  PRODUCTION_REWARDED_UNITS,
  REWARD_CONFIRM_DELAYS_MS,
  renderableKind,
  rewardedUnitFor,
  shouldRequestSlot,
  TEST_REWARDED_UNIT,
} from '../lib/ads.ts';

test('보상형 광고(SOMA-1067) — dev·개발 빌드는 Google 테스트 단위, 운영 빌드는 운영 단위가 비어 있으면 null(버튼 숨김)', () => {
  assert.equal(rewardedUnitFor('ios', 'https://dev.acttub.com'), TEST_REWARDED_UNIT.ios);
  assert.equal(rewardedUnitFor('android', undefined), TEST_REWARDED_UNIT.android);
  assert.equal(rewardedUnitFor('android', 'https://acttub.com'), PRODUCTION_REWARDED_UNITS.android || null);
  const saved = { ...PRODUCTION_REWARDED_UNITS };
  try {
    PRODUCTION_REWARDED_UNITS.ios = '';
    assert.equal(rewardedUnitFor('ios', 'https://acttub.com'), null);
    PRODUCTION_REWARDED_UNITS.ios = 'ca-app-pub-1/2';
    assert.equal(rewardedUnitFor('ios', 'https://acttub.com'), 'ca-app-pub-1/2');
  } finally {
    Object.assign(PRODUCTION_REWARDED_UNITS, saved);
  }
});

test('지급 확인은 간격마다 묻고 확인되면 멈춘다 — 전체 약 10초, 묻기 실패는 다음 간격에 다시', async () => {
  assert.equal(REWARD_CONFIRM_DELAYS_MS.reduce((sum, ms) => sum + ms, 0), 10_000);
  const waited = [];
  const wait = async (ms) => {
    waited.push(ms);
  };
  let calls = 0;
  const answers = [Promise.reject(new Error('offline')), Promise.resolve(false), Promise.resolve(true)];
  answers[0].catch(() => {});
  assert.equal(await confirmReward(() => answers[calls++], wait), true);
  assert.equal(calls, 3);
  assert.deepEqual(waited, [1000, 1500, 2000]);

  waited.length = 0;
  assert.equal(await confirmReward(async () => false, wait), false);
  assert.deepEqual(waited, [...REWARD_CONFIRM_DELAYS_MS]);
});

const pick = (kind, ad = null) => ({ kind, slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad });
const creative = (over) => ({ id: 'a', image_url: null, headline: null, body: null, app_path: null, advertiser_name: null, link_url: null, ...over });

test('dev·개발 빌드는 Google 테스트 단위, 운영 API 빌드만 실제 단위를 칸의 갈래대로 쓴다', () => {
  assert.equal(bannerUnitFor('home_top', 'ios', 'https://dev.acttub.com'), TEST_BANNER_UNIT.ios);
  assert.equal(bannerUnitFor('home_top', 'android', undefined), TEST_BANNER_UNIT.android);
  assert.equal(bannerUnitFor('home_top', 'android', 'https://acttub.com/'), PRODUCTION_BANNER_UNITS.browse.android);
  assert.equal(bannerUnitFor('upload_wait', 'ios', 'https://acttub.com'), PRODUCTION_BANNER_UNITS.practice.ios);
  assert.equal(bannerUnitFor('community_list_top', 'ios', 'https://acttub.com'), PRODUCTION_BANNER_UNITS.community.ios);
});

test('첫 사용자로 확인되면 서버에 묻지 않는다', () => {
  assert.equal(shouldRequestSlot('first'), false);
  assert.equal(shouldRequestSlot('unknown'), true);
  assert.equal(shouldRequestSlot('practiced'), true);
});

test('그릴 수 없는 응답은 비운다', () => {
  assert.equal(renderableKind(null), 'NONE');
  assert.equal(renderableKind(pick('NETWORK')), 'NETWORK');
  assert.equal(renderableKind(pick('DIRECT', creative({ image_url: 'x.png', link_url: 'https://example.com' }))), 'DIRECT');
  assert.equal(renderableKind(pick('DIRECT', creative({ image_url: 'x.png' }))), 'NONE');
  assert.equal(renderableKind(pick('DIRECT', creative({ image_url: 'x.png', link_url: 'javascript:alert(1)' }))), 'NONE');
  assert.equal(renderableKind(pick('DIRECT', creative({ link_url: 'https://example.com' }))), 'NONE');
  assert.equal(renderableKind(pick('HOUSE', creative({ headline: '챌린지', app_path: '/challenges' }))), 'HOUSE');
  assert.equal(renderableKind(pick('HOUSE', creative({ headline: '챌린지', app_path: 'https://x' }))), 'NONE');
  assert.equal(renderableKind(pick('WHAT')), 'NONE');
});

test('앱 밖으로 여는 링크는 http(s)만', () => {
  assert.equal(isHttpLink('https://example.com/a?b=1'), true);
  assert.equal(isHttpLink('http://example.com'), true);
  for (const bad of [null, undefined, '', 'ftp://x', 'javascript:alert(1)', 'example.com', 'https://a b']) assert.equal(isHttpLink(bad), false);
});

test('네이티브 모듈이 없으면(테스트·Expo Go) AdMob 초기화는 조용히 끝나고 배너 모듈은 없다', async () => {
  const { initAdMob, loadBannerModule } = await import('../lib/ads-native.ts');
  await initAdMob();
  await initAdMob();
  assert.equal(loadBannerModule(), null);
});

test('성인(만 19세 이상)은 등급 T, 나머지 설정은 기본', () => {
  assert.deepEqual(adRequestConfigFor('1995-03-02', '2026-10-26'), {
    maxAdContentRating: 'T',
    tagForUnderAgeOfConsent: false,
    tagForChildDirectedTreatment: false,
    requestNonPersonalizedAdsOnly: false,
  });
});

test('만 18세는 G + 미성년 표시 + 비맞춤, 아동 표시는 켜지 않는다', () => {
  assert.deepEqual(adRequestConfigFor('2008-05-01', '2026-10-26'), {
    maxAdContentRating: 'G',
    tagForUnderAgeOfConsent: true,
    tagForChildDirectedTreatment: false,
    requestNonPersonalizedAdsOnly: true,
  });
});

test('만 12세는 아동 대상 처리도 켠다, 만 13세는 켜지 않는다', () => {
  assert.equal(adRequestConfigFor('2014-10-27', '2026-10-26').tagForChildDirectedTreatment, true);
  assert.equal(adRequestConfigFor('2013-10-26', '2026-10-26').tagForChildDirectedTreatment, false);
});

test('생년월일이 없거나 형식이 틀리면 청소년 기준(아동 표시 없이)이다', () => {
  for (const value of [null, undefined, '', '19950302', 'abcd-ef-gh']) {
    assert.deepEqual(adRequestConfigFor(value, '2026-10-26'), {
      maxAdContentRating: 'G',
      tagForUnderAgeOfConsent: true,
      tagForChildDirectedTreatment: false,
      requestNonPersonalizedAdsOnly: true,
    });
  }
});

test('만 19세 경계: 19번째 생일 전날은 G, 당일부터 T', () => {
  assert.equal(adRequestConfigFor('2007-10-27', '2026-10-26').maxAdContentRating, 'G');
  assert.equal(adRequestConfigFor('2007-10-26', '2026-10-26').maxAdContentRating, 'T');
});

test('영어로 쓰는 사람에게는 한국어로 만든 직접·우리 앱 광고 대신 AdMob 으로 채운다', () => {
  const direct = pick('DIRECT', creative({ image_url: 'x.png', link_url: 'https://example.com' }));
  const house = pick('HOUSE', creative({ image_url: 'x.png', app_path: '/pro' }));
  assert.equal(renderableKind(direct, { korean: false }), 'NETWORK');
  assert.equal(renderableKind(house, { korean: false }), 'NETWORK');
  assert.equal(renderableKind(direct, { korean: true }), 'DIRECT');
  assert.equal(renderableKind(pick('NETWORK'), { korean: false }), 'NETWORK');
});

// ── 전면 광고(SOMA-1085) ─────────────────────────────────

import {
  FULL_SCREEN_GAP_MS,
  PRODUCTION_INTERSTITIAL_UNITS,
  TEST_INTERSTITIAL_UNIT,
  fullScreenAllowed,
  interstitialUnitFor,
} from '../lib/ads.ts';

test('전면 칸은 세 곳이고 서버 키와 같다', () => {
  for (const slot of ['analyzing_wait_full', 'script_parse_full', 'reading_done_full']) {
    assert.ok(slot in AD_SLOTS, slot);
  }
});

test('전면 광고 단위 — dev·개발 빌드는 Google 테스트 전면 단위, 운영 단위가 비어 있으면 띄우지 않는다', () => {
  assert.equal(interstitialUnitFor('android', 'https://dev.acttub.com'), TEST_INTERSTITIAL_UNIT.android);
  assert.equal(interstitialUnitFor('ios', undefined), TEST_INTERSTITIAL_UNIT.ios);
  const expected = PRODUCTION_INTERSTITIAL_UNITS.android || null;
  assert.equal(interstitialUnitFor('android', 'https://acttub.com'), expected);
});

test('전면 광고는 서버가 NETWORK 를 줄 때만, 첫 사용자가 아니고 3분 안에 띄운 적이 없을 때만 띄운다', () => {
  const now = 1_000_000_000;
  const network = { kind: 'NETWORK', slot: 'reading_done_full', size: 'MEDIUM_RECTANGLE', width: 300, height: 250, ad: null };
  assert.equal(FULL_SCREEN_GAP_MS, 3 * 60_000);
  assert.equal(fullScreenAllowed({ pick: network, firstTime: 'practiced', lastShownAt: null, now }), true);
  assert.equal(fullScreenAllowed({ pick: network, firstTime: 'unknown', lastShownAt: null, now }), true);
  assert.equal(fullScreenAllowed({ pick: network, firstTime: 'first', lastShownAt: null, now }), false);
  assert.equal(fullScreenAllowed({ pick: { ...network, kind: 'NONE' }, firstTime: 'practiced', lastShownAt: null, now }), false);
  assert.equal(fullScreenAllowed({ pick: null, firstTime: 'practiced', lastShownAt: null, now }), false);
  assert.equal(fullScreenAllowed({ pick: network, firstTime: 'practiced', lastShownAt: now - FULL_SCREEN_GAP_MS + 1, now }), false);
  assert.equal(fullScreenAllowed({ pick: network, firstTime: 'practiced', lastShownAt: now - FULL_SCREEN_GAP_MS, now }), true);
});

import { nonPersonalizedAdsOnly, setAdRequestConfig } from '../lib/ads-native.ts';

test('전면 광고 비맞춤 여부는 마지막으로 건 나이별 요청 설정을 따른다 — 프로필을 받기 전에는 청소년 기준', async () => {
  assert.equal(nonPersonalizedAdsOnly(), true);
  await setAdRequestConfig(adRequestConfigFor('1990-01-01', '2026-11-22'));
  assert.equal(nonPersonalizedAdsOnly(), false);
  await setAdRequestConfig(adRequestConfigFor(null, '2026-11-22'));
  assert.equal(nonPersonalizedAdsOnly(), true);
});
