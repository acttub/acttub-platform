import assert from 'node:assert/strict';
import test from 'node:test';

import { cachedNotice, forgetNotices, formatNoticeDate, noticeCta, noticeImageAsset, rememberNotices } from '../lib/notices.ts';

function notice(overrides = {}) {
  return {
    slug: 'terms-billing-2026-11', revision: 1, live: true, published_at: '2026-10-27T00:00:00Z', ends_at: null,
    badge: null, title: '약관 개정', body: '본문', image_url: null, image_asset: null,
    cta_label: '요금 보기', cta_action: 'route', cta_target: '/pro', ...overrides,
  };
}

test('버튼은 지금 떠 있는 공지의 안전한 앱 경로나 https 주소만 보인다', () => {
  assert.deepEqual(noticeCta(notice()), { kind: 'route', label: '요금 보기', target: '/pro' });
  assert.deepEqual(noticeCta(notice({ cta_action: 'url', cta_target: 'https://acttub.com/pricing' })),
    { kind: 'url', label: '요금 보기', target: 'https://acttub.com/pricing' });
  assert.equal(noticeCta(notice({ live: false })), null);
  assert.equal(noticeCta(notice({ cta_label: null })), null);
  assert.equal(noticeCta(notice({ cta_target: 'pro' })), null);
  assert.equal(noticeCta(notice({ cta_action: 'url', cta_target: 'http://acttub.com' })), null);
  assert.equal(noticeCta(notice({ cta_action: 'cloud_voice_enable', cta_target: null })), null);
  assert.equal(noticeCta(notice({ cta_action: 'none', cta_target: null })), null);
});

test('앱이 아는 이미지 이름만 그림 칸이 된다', () => {
  assert.equal(noticeImageAsset(notice({ image_asset: 'mascot-reading' })), 'mascot-reading');
  assert.equal(noticeImageAsset(notice({ image_asset: 'unknown' })), null);
  assert.equal(noticeImageAsset(notice()), null);
});

test('공지한 날은 한국 날짜로 적고 읽을 수 없으면 비운다', () => {
  assert.equal(formatNoticeDate('2026-10-31T16:00:00Z', 'ko-KR'), '2026년 11월 1일');
  assert.equal(formatNoticeDate('2026-10-31T16:00:00Z', 'en-US'), 'November 1, 2026');
  assert.equal(formatNoticeDate('nope', 'ko-KR'), '');
});

test('목록을 받은 뒤 상세가 slug 로 같은 공지를 찾고, 비우면 없다', () => {
  forgetNotices();
  assert.equal(cachedNotice('a'), null);
  rememberNotices([notice({ slug: 'a' }), notice({ slug: 'b' })]);
  assert.equal(cachedNotice('b')?.slug, 'b');
  assert.equal(cachedNotice('c'), null);
  forgetNotices();
  assert.equal(cachedNotice('a'), null);
});
