import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISCOVERY_OTHER_MAX_LENGTH,
  DISCOVERY_SOURCES,
  EMPTY_DISCOVERY,
  buildDiscoveryPayload,
  chooseDiscoverySource,
  discoveryOrder,
  limitOtherText,
  shouldAskDiscovery,
} from '../lib/discovery.ts';
import en from '../locales/en.ts';
import ko from '../locales/ko.ts';

// 서버(DiscoveryAnswer.SOURCES)는 academy_school·community 와 인스타그램 세부도 아직 받는다. 화면은 그 일부만 쓴다.
const SERVER_SOURCES = [
  'instagram', 'naver_search', 'google_youtube', 'app_store_search',
  'friend', 'academy_school', 'community', 'other',
];

test('선택지는 여섯 개(SOMA-733)이고 모두 서버 허용값(SOMA-649) 안에 있다', () => {
  assert.deepEqual([...DISCOVERY_SOURCES], [
    'instagram', 'app_store_search', 'naver_search', 'google_youtube', 'friend', 'other',
  ]);
  for (const source of DISCOVERY_SOURCES) assert.ok(SERVER_SOURCES.includes(source), source);
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

test('같은 것을 다시 누르면 풀리고, 다른 것을 고르면 직접 입력을 비운다', () => {
  let state = chooseDiscoverySource(EMPTY_DISCOVERY, 'other');
  state = { ...state, otherText: '유튜브' };
  assert.deepEqual(chooseDiscoverySource(state, 'friend'), { source: 'friend', otherText: '' });
  assert.deepEqual(chooseDiscoverySource(state, 'other'), EMPTY_DISCOVERY);
});

test('본문은 고르지 않으면 건너뜀(source=null)이고, 세부는 늘 null, 직접 입력은 기타일 때만 싣는다', () => {
  assert.deepEqual(buildDiscoveryPayload(EMPTY_DISCOVERY), { source: null, detail: null, other_text: null });
  assert.deepEqual(buildDiscoveryPayload({ source: 'instagram', otherText: 'x' }),
    { source: 'instagram', detail: null, other_text: null });
  assert.deepEqual(buildDiscoveryPayload({ source: 'other', otherText: '  유튜브 쇼츠  ' }),
    { source: 'other', detail: null, other_text: '유튜브 쇼츠' });
  assert.deepEqual(buildDiscoveryPayload({ source: 'other', otherText: '   ' }),
    { source: 'other', detail: null, other_text: null });
});

test('Airbridge 가 출처를 확인한 설치는 묻지 않고, 모르거나 아직 안 왔으면 묻는다', () => {
  assert.equal(shouldAskDiscovery('facebook.business'), false);
  assert.equal(shouldAskDiscovery('threads'), false);
  assert.equal(shouldAskDiscovery('unattributed'), true);
  assert.equal(shouldAskDiscovery('restricted'), true);
  assert.equal(shouldAskDiscovery(' Unattributed '), true);
  assert.equal(shouldAskDiscovery(null), true);
  assert.equal(shouldAskDiscovery(undefined), true);
  assert.equal(shouldAskDiscovery('  '), true);
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
  assert.deepEqual(Object.keys(ko.profileName.discoverySources).sort(), [...DISCOVERY_SOURCES].sort());
  assert.equal(ko.profileName.discoverySources.google_youtube, '구글');
  assert.equal(ko.profileName.discoveryLabel, 'Acttub를 처음 어디서 알게 됐어요?');
  assert.doesNotMatch(en.profileName.discoveryLabel, /[가-힣]/);
});
