import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  READING_RATING_PENDING_KEY,
  buildReadingRatingBody,
  createReadingRatingQueue,
} from '../lib/reading/session-rating.ts';
import { NOTE_RATING_PENDING_KEY } from '../lib/practice/note-rating.ts';

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
