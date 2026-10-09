import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISCOVERY_OTHER_MAX_LENGTH,
  DISCOVERY_SOURCES,
  EMPTY_DISCOVERY,
  INSTAGRAM_DETAILS,
  buildDiscoveryPayload,
  chooseDiscoverySource,
  chooseInstagramDetail,
  discoveryOrder,
  limitOtherText,
} from '../lib/discovery.ts';
import en from '../locales/en.ts';
import ko from '../locales/ko.ts';

test('값 이름은 서버 허용값(SOMA-649)과 같다', () => {
  assert.deepEqual([...DISCOVERY_SOURCES], [
    'instagram', 'naver_search', 'google_youtube', 'app_store_search',
    'friend', 'academy_school', 'community', 'other',
  ]);
  assert.deepEqual([...INSTAGRAM_DETAILS], ['ad', 'official_post', 'other_post', 'unknown']);
  assert.equal(DISCOVERY_OTHER_MAX_LENGTH, 30);
});

test('선택지 순서는 섞되 기타는 늘 맨 아래이고 빠지거나 겹치는 것이 없다', () => {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const orders = new Set();
  for (let i = 0; i < 20; i += 1) {
    const order = discoveryOrder(random);
    assert.equal(order.at(-1), 'other');
    assert.deepEqual([...order].sort(), [...DISCOVERY_SOURCES].sort());
    orders.add(order.join(','));
  }
  assert.ok(orders.size > 1, '여러 번 섞으면 순서가 달라진다');
});

test('같은 것을 다시 누르면 풀리고, 다른 것을 고르면 세부와 직접 입력을 비운다', () => {
  let state = chooseDiscoverySource(EMPTY_DISCOVERY, 'instagram');
  state = chooseInstagramDetail(state, 'ad');
  assert.deepEqual(state, { source: 'instagram', detail: 'ad', otherText: '' });
  assert.deepEqual(chooseInstagramDetail(state, 'ad'), { source: 'instagram', detail: null, otherText: '' });
  assert.deepEqual(chooseDiscoverySource(state, 'friend'), { source: 'friend', detail: null, otherText: '' });
  assert.deepEqual(chooseDiscoverySource(state, 'instagram'), EMPTY_DISCOVERY);
  // 인스타그램이 아니면 세부를 받지 않는다
  assert.deepEqual(chooseInstagramDetail({ source: 'friend', detail: null, otherText: '' }, 'ad'),
    { source: 'friend', detail: null, otherText: '' });
});

test('본문은 고르지 않으면 건너뜀(source=null)이고, 세부·직접 입력은 맞는 경우에만 싣는다', () => {
  assert.deepEqual(buildDiscoveryPayload(EMPTY_DISCOVERY), { source: null, detail: null, other_text: null });
  assert.deepEqual(buildDiscoveryPayload({ source: 'instagram', detail: 'official_post', otherText: 'x' }),
    { source: 'instagram', detail: 'official_post', other_text: null });
  assert.deepEqual(buildDiscoveryPayload({ source: 'friend', detail: 'ad', otherText: '' }),
    { source: 'friend', detail: null, other_text: null });
  assert.deepEqual(buildDiscoveryPayload({ source: 'other', detail: null, otherText: '  유튜브 쇼츠  ' }),
    { source: 'other', detail: null, other_text: '유튜브 쇼츠' });
  assert.deepEqual(buildDiscoveryPayload({ source: 'other', detail: null, otherText: '   ' }),
    { source: 'other', detail: null, other_text: null });
});

test('직접 입력은 30자(코드 포인트)까지 자른다', () => {
  assert.equal([...limitOtherText('가'.repeat(40))].length, 30);
  assert.equal(limitOtherText('😀'.repeat(31)), '😀'.repeat(30));
});

test('모든 선택지에 한국어·영어 문구가 있고 영어 문구에는 한글이 없다', () => {
  for (const source of DISCOVERY_SOURCES) {
    assert.ok(ko.profileName.discoverySources[source], source);
    assert.ok(en.profileName.discoverySources[source], source);
    assert.doesNotMatch(en.profileName.discoverySources[source], /[가-힣]/);
  }
  for (const detail of INSTAGRAM_DETAILS) {
    assert.ok(ko.profileName.discoveryInstagramDetails[detail], detail);
    assert.ok(en.profileName.discoveryInstagramDetails[detail], detail);
  }
  assert.equal(ko.profileName.discoveryLabel, '액터브를 처음 어디서 알게 됐어요?');
  assert.doesNotMatch(en.profileName.discoveryLabel, /[가-힣]/);
});
