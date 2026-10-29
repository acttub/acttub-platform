import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AD_SLOTS,
  PRODUCTION_BANNER_UNITS,
  adRequestConfigFor,
  TEST_BANNER_UNIT,
  bannerUnitFor,
  isHttpLink,
  renderableKind,
  shouldRequestSlot,
  slotHeight,
} from '../lib/ads.ts';

const pick = (kind, ad = null) => ({ kind, slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad });
const creative = (over) => ({ id: 'a', image_url: null, headline: null, body: null, app_path: null, advertiser_name: null, link_url: null, ...over });

test('dev·개발 빌드는 Google 테스트 단위, 운영 API 빌드만 실제 단위를 칸의 갈래대로 쓴다', () => {
  assert.equal(bannerUnitFor('home_top', 'ios', 'https://dev.acttub.com'), TEST_BANNER_UNIT.ios);
  assert.equal(bannerUnitFor('home_top', 'android', undefined), TEST_BANNER_UNIT.android);
  assert.equal(bannerUnitFor('home_top', 'android', 'https://acttub.com/'), PRODUCTION_BANNER_UNITS.browse.android);
  assert.equal(bannerUnitFor('upload_wait', 'ios', 'https://acttub.com'), PRODUCTION_BANNER_UNITS.practice.ios);
  assert.equal(bannerUnitFor('community_list_top', 'ios', 'https://acttub.com'), PRODUCTION_BANNER_UNITS.community.ios);
});

test('칸 높이는 칸 폭에 규격 비율을 맞추고 규격보다 작아지지 않는다', () => {
  assert.equal(slotHeight('LARGE_BANNER', 352), 110);
  assert.equal(slotHeight('BANNER', 320), 50);
  assert.equal(slotHeight('MEDIUM_RECTANGLE', 200), 250);
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
