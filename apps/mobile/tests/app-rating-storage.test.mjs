import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_RATING_STATE, afterAsk, afterRated, parseRatingState, recordEvent, storeReviewUrl } from '../lib/app-rating.ts';

// practice.rating 「예외」: 기기에 저장된 값이 깨졌으면 처음 상태로 돌아간다.
const T0 = Date.parse('2026-09-28T10:00:00+09:00');

test('practice.rating: 저장한 상태를 다시 읽으면 같은 상태다', () => {
  const asked = afterAsk(recordEvent(EMPTY_RATING_STATE, { kind: 'coach', practiceId: 'p1' }, T0).state, T0);
  const saved = afterRated(asked);
  assert.deepEqual(parseRatingState(JSON.stringify(saved)), {
    rated: true,
    asks: 1,
    lastAskAt: T0,
    coachSinceAsk: 0,
    readingSinceAsk: 0,
    counted: ['p1'],
  });
});

test('practice.rating: 저장값이 없거나 JSON 이 아니면 처음 상태다', () => {
  assert.deepEqual(parseRatingState(null), EMPTY_RATING_STATE);
  assert.deepEqual(parseRatingState(''), EMPTY_RATING_STATE);
  assert.deepEqual(parseRatingState('{not json'), EMPTY_RATING_STATE);
});

test('practice.rating: 모양이 다른 필드는 처음 값으로, 센 연습 id 는 글자만 남긴다', () => {
  assert.deepEqual(
    parseRatingState(JSON.stringify({ rated: 'yes', asks: '2', lastAskAt: 'x', coachSinceAsk: null, readingSinceAsk: {}, counted: ['p1', 7, null, 'p2'] })),
    { rated: false, asks: 0, lastAskAt: null, coachSinceAsk: 0, readingSinceAsk: 0, counted: ['p1', 'p2'] },
  );
  assert.deepEqual(parseRatingState(JSON.stringify({ counted: 'p1' })).counted, []);
});

test('practice.rating: 스토어 리뷰 쓰기 화면은 플랫폼별 주소로 연다', () => {
  assert.equal(storeReviewUrl('ios'), 'itms-apps://apps.apple.com/app/id6793056855?action=write-review');
  assert.equal(storeReviewUrl('android'), 'https://play.google.com/store/apps/details?id=com.acttub.app&showAllReviews=true');
});
