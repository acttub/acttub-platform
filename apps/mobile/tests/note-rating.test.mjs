import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTE_RATING_COMMENT_MAX,
  NOTE_RATING_PENDING_KEY,
  buildNoteRatingBody,
  commentTooLong,
  createNoteRatingQueue,
  noteRatingCommentText,
} from '../lib/practice/note-rating.ts';

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  };
}

const apiError = (status) => Object.assign(new Error(String(status)), { status });
const pending = (storage) => JSON.parse(storage.items.get(NOTE_RATING_PENDING_KEY) ?? '[]');

test('practice.note: 한 줄은 앞뒤 공백을 걷고 비었으면 보내지 않는다', () => {
  assert.equal(noteRatingCommentText('  시선 얘기가 좋았어요  '), '시선 얘기가 좋았어요');
  assert.equal(noteRatingCommentText('   '), null);
  assert.deepEqual(buildNoteRatingBody({ requestId: 'r1', rating: 'helpful', comment: '  ' }), {
    request_id: 'r1',
    rating: 'helpful',
  });
  assert.deepEqual(buildNoteRatingBody({ requestId: 'r2', rating: 'not_helpful', comment: ' 길었어요 ' }), {
    request_id: 'r2',
    rating: 'not_helpful',
    comment: '길었어요',
  });
  assert.deepEqual(buildNoteRatingBody({ requestId: 'r3', rating: 'helpful', comment: null }), {
    request_id: 'r3',
    rating: 'helpful',
  });
});

test('practice.note: 한 줄 길이는 코드 포인트로 센다 — 이모지 100개는 된다', () => {
  assert.equal(NOTE_RATING_COMMENT_MAX, 100);
  assert.equal(commentTooLong('🎭'.repeat(100)), false);
  assert.equal(commentTooLong('가'.repeat(101)), true);
  assert.equal(commentTooLong(`  ${'가'.repeat(100)}  `), false);
});

test('practice.note: 보내기가 성공하면 대기열에 남지 않는다', async () => {
  const storage = memoryStorage();
  const sent = [];
  const queue = createNoteRatingQueue({ storage, submit: async (practiceId, body) => void sent.push([practiceId, body]) });

  const result = await queue.send('p1', { request_id: 'r1', rating: 'helpful' });

  assert.equal(result, 'sent');
  assert.deepEqual(sent, [['p1', { request_id: 'r1', rating: 'helpful' }]]);
  assert.equal(storage.items.has(NOTE_RATING_PENDING_KEY), false);
});

test('practice.note: 네트워크 실패는 기기가 들고 있다가 같은 요청 id 로 다시 보낸다', async () => {
  const storage = memoryStorage();
  const sent = [];
  let online = false;
  const queue = createNoteRatingQueue({
    storage,
    submit: async (practiceId, body) => {
      if (!online) throw new TypeError('Network request failed');
      sent.push([practiceId, body]);
    },
  });

  assert.equal(await queue.send('p1', { request_id: 'r1', rating: 'helpful', comment: '좋았어요' }), 'queued');
  assert.deepEqual(pending(storage), [{ practice_id: 'p1', body: { request_id: 'r1', rating: 'helpful', comment: '좋았어요' } }]);

  // 여전히 오프라인이면 그대로 들고 있는다.
  assert.deepEqual(await queue.flush(), { sent: 0, kept: 1 });
  assert.equal(pending(storage).length, 1);

  online = true;
  assert.deepEqual(await queue.flush(), { sent: 1, kept: 0 });
  assert.deepEqual(sent, [['p1', { request_id: 'r1', rating: 'helpful', comment: '좋았어요' }]]);
  assert.equal(storage.items.has(NOTE_RATING_PENDING_KEY), false);
});

test('practice.note: 같은 노트는 마지막 것 하나만 들고 있다 — 옛 요청이 나중 평가를 덮지 않는다', async () => {
  const storage = memoryStorage();
  const sent = [];
  let online = false;
  const queue = createNoteRatingQueue({
    storage,
    submit: async (practiceId, body) => {
      if (!online) throw apiError(503);
      sent.push([practiceId, body.request_id]);
    },
  });

  await queue.send('p1', { request_id: 'r1', rating: 'helpful' });
  await queue.send('p2', { request_id: 'r2', rating: 'not_helpful' });
  await queue.send('p1', { request_id: 'r3', rating: 'not_helpful', comment: '질문이 길었어요' });

  assert.deepEqual(pending(storage).map((item) => [item.practice_id, item.body.request_id]), [['p2', 'r2'], ['p1', 'r3']]);

  online = true;
  await queue.flush();
  assert.deepEqual(sent, [['p2', 'r2'], ['p1', 'r3']]);
});

test('practice.note: 새 평가가 바로 성공하면 그 노트의 밀린 옛 요청은 버린다', async () => {
  const storage = memoryStorage();
  const sent = [];
  let online = false;
  const queue = createNoteRatingQueue({
    storage,
    submit: async (practiceId, body) => {
      if (!online) throw apiError(502);
      sent.push(body.request_id);
    },
  });

  await queue.send('p1', { request_id: 'old', rating: 'helpful' });
  online = true;
  assert.equal(await queue.send('p1', { request_id: 'new', rating: 'not_helpful' }), 'sent');
  assert.equal(storage.items.has(NOTE_RATING_PENDING_KEY), false);

  await queue.flush();
  assert.deepEqual(sent, ['new']);
});

test('practice.note: 4xx(노트 없음·지문 불일치·형식 오류)는 들고 있어도 소용없어 버린다', async () => {
  const storage = memoryStorage();
  const queue = createNoteRatingQueue({ storage, submit: async () => { throw apiError(404); } });

  assert.equal(await queue.send('p1', { request_id: 'r1', rating: 'helpful' }), 'dropped');
  assert.equal(storage.items.has(NOTE_RATING_PENDING_KEY), false);

  storage.items.set(NOTE_RATING_PENDING_KEY, JSON.stringify([{ practice_id: 'p1', body: { request_id: 'r1', rating: 'helpful' } }]));
  const failing = createNoteRatingQueue({ storage, submit: async () => { throw apiError(422); } });
  assert.deepEqual(await failing.flush(), { sent: 0, kept: 0 });
  assert.equal(storage.items.has(NOTE_RATING_PENDING_KEY), false);
});

test('practice.note: 저장소가 깨져 있어도 보내기를 막지 않는다', async () => {
  const storage = memoryStorage({ [NOTE_RATING_PENDING_KEY]: '{not json' });
  const queue = createNoteRatingQueue({ storage, submit: async () => { throw new TypeError('offline'); } });

  assert.equal(await queue.send('p1', { request_id: 'r1', rating: 'helpful' }), 'queued');
  assert.deepEqual(pending(storage), [{ practice_id: 'p1', body: { request_id: 'r1', rating: 'helpful' } }]);
});
