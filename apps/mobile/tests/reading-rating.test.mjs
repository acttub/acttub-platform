import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  READING_BAD_REASONS,
  READING_RATING_COMMENT_MAX,
  READING_RATING_PENDING_KEY,
  buildReadingRatingBody,
  createReadingRatingQueue,
} from '../lib/reading/session-rating.ts';
import { NOTE_RATING_PENDING_KEY, ratingCommentWithReasons } from '../lib/practice/note-rating.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

test('리딩 평가 본문: 좋았어요·아쉬웠어요 + 한 줄(앞뒤 공백을 걷고, 비면 빼고 보낸다)', () => {
  assert.deepEqual(buildReadingRatingBody({ requestId: 'r1', rating: 'good', comment: '  상대역 목소리가 좋았어요 ' }), {
    request_id: 'r1',
    rating: 'good',
    comment: '상대역 목소리가 좋았어요',
  });
  assert.deepEqual(buildReadingRatingBody({ requestId: 'r2', rating: 'bad', comment: '   ' }), { request_id: 'r2', rating: 'bad' });
});

test('이유 칩 문구는 한 줄 앞에 붙고, 이유만·글만도 되며, 100자를 넘으면 자른다(11/27)', () => {
  const max = READING_RATING_COMMENT_MAX;
  assert.equal(ratingCommentWithReasons(['느려요', '다음 줄로 안 넘어가요'], '  목소리도 작아요 ', max), '느려요, 다음 줄로 안 넘어가요 / 목소리도 작아요');
  assert.equal(ratingCommentWithReasons(['느려요'], '   ', max), '느려요');
  assert.equal(ratingCommentWithReasons([], ' 글만 ', max), '글만');
  assert.equal(ratingCommentWithReasons([], '   ', max), null);
  const long = ratingCommentWithReasons(['상대 목소리가 어색해요'], '가'.repeat(200), max);
  assert.equal(long.length, max);
  assert.ok(long.startsWith('상대 목소리가 어색해요 / 가'));
  // 자른 자리가 이모지 반쪽이면 그 반쪽을 뺀다.
  const emoji = ratingCommentWithReasons([], `${'가'.repeat(max - 1)}😀`, max);
  assert.equal(emoji, '가'.repeat(max - 1));
  // 서버 계약(1~100자, 공백만 안 됨)을 그대로 지킨다.
  assert.deepEqual(buildReadingRatingBody({ requestId: 'r3', rating: 'bad', comment: ratingCommentWithReasons(['느려요'], '', max) }), {
    request_id: 'r3',
    rating: 'bad',
    comment: '느려요',
  });
});

test('이유 칩 코드는 짧은 영문이고 문구 키가 ko·en 에 모두 있다', () => {
  const ko = read('locales/ko.ts');
  const en = read('locales/en.ts');
  assert.deepEqual(READING_BAD_REASONS.map(([code]) => code), ['voice', 'no_advance', 'early_advance', 'slow']);
  for (const [code, key] of READING_BAD_REASONS) {
    assert.match(code, /^[a-z_]+$/);
    assert.match(ko, new RegExp(`${key}: '`));
    assert.match(en, new RegExp(`${key}: '`));
  }
});

test('못 보낸 리딩 평가는 노트 평가와 다른 자리에 회차마다 마지막 하나만 들고 있다가 다시 보낸다', async () => {
  assert.notEqual(READING_RATING_PENDING_KEY, NOTE_RATING_PENDING_KEY);
  assert.match(READING_RATING_PENDING_KEY, /^acttub\./);
  const storage = memoryStorage();
  let fail = true;
  const sent = [];
  const queue = createReadingRatingQueue({
    storage,
    submit: async (sessionId, body) => {
      if (fail) throw Object.assign(new Error('offline'), { name: 'NetworkError' });
      sent.push([sessionId, body.request_id]);
    },
  });
  assert.equal(await queue.send('s1', buildReadingRatingBody({ requestId: 'a', rating: 'good' })), 'queued');
  assert.equal(await queue.send('s1', buildReadingRatingBody({ requestId: 'b', rating: 'bad' })), 'queued');
  assert.ok(storage.map.has(READING_RATING_PENDING_KEY));
  assert.equal(storage.map.has(NOTE_RATING_PENDING_KEY), false);
  fail = false;
  assert.deepEqual(await queue.flush(), { sent: 1, kept: 0 });
  assert.deepEqual(sent, [['s1', 'b']]);
});

test('리딩이 끝난 화면에 「이번 리딩 어땠나요?」가 있고 서버(회차 단위)로 보낸다 — 튜토리얼 예시는 빼고', () => {
  const box = read('components/reading-rating.tsx');
  assert.match(box, /readingRatings\.send/);
  for (const key of ['rateTitle', 'rateGood', 'rateBad', 'ratePh', 'rateThanks']) assert.match(box, new RegExp(`reading\\.${key}`));
  assert.match(read('locales/ko.ts'), /rateTitle: '이번 리딩 어땠나요\?'/);
  assert.match(read('lib/api.ts'), /\/v2\/reading\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/rating/);
  assert.match(read('lib/auth.tsx'), /flushReadingRatings\(\)/);
});
