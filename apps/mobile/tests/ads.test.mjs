import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AD_SLOTS,
  PRODUCTION_BANNER_UNITS,
  TEST_BANNER_UNIT,
  bannerUnitFor,
  renderableKind,
  shouldRequestSlot,
  slotHeight,
} from '../lib/ads.ts';

const pick = (kind, ad = null) => ({ kind, slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad });
const creative = (over) => ({ id: 'a', image_url: null, headline: null, body: null, app_path: null, advertiser_name: null, ...over });

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
  assert.equal(renderableKind(pick('DIRECT', creative({ image_url: 'x.png' }))), 'DIRECT');
  assert.equal(renderableKind(pick('DIRECT', creative({}))), 'NONE');
  assert.equal(renderableKind(pick('HOUSE', creative({ headline: '챌린지', app_path: '/challenges' }))), 'HOUSE');
  assert.equal(renderableKind(pick('HOUSE', creative({ headline: '챌린지', app_path: 'https://x' }))), 'NONE');
  assert.equal(renderableKind(pick('WHAT')), 'NONE');
});
