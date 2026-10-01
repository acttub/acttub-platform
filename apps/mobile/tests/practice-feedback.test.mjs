import assert from 'node:assert/strict';
import test from 'node:test';

import { FEEDBACK_PENDING_KEY, createFeedbackQueue } from '../lib/practice/feedback.ts';

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

const pendingBody = {
  request_id: 'req-3',
  practice_id: 'practice-1',
  screen: 'coach',
  trigger: 'leave',
  body: '한 줄 남겨요',
};

test('practice.feedback: 밀린 접수는 오프라인이면 들고 있다가 다시 보낸다', async () => {
  const storage = memoryStorage({ [FEEDBACK_PENDING_KEY]: JSON.stringify([pendingBody]) });
  let online = false;
  const seen = [];
  const queue = createFeedbackQueue({
    storage,
    submit: async (body) => {
      if (!online) throw Object.assign(new Error('offline'), { name: 'NetworkError' });
      seen.push(body.request_id);
    },
  });

  assert.deepEqual(await queue.flush(), { sent: 0, kept: 1 });
  assert.equal(storage.items.has(FEEDBACK_PENDING_KEY), true);

  online = true;
  assert.deepEqual(await queue.flush(), { sent: 1, kept: 0 });
  assert.deepEqual(seen, ['req-3']);
  assert.equal(storage.items.has(FEEDBACK_PENDING_KEY), false);
});

test('practice.feedback: 서버가 형식을 거절하면(422) 밀린 접수를 버린다', async () => {
  const storage = memoryStorage({ [FEEDBACK_PENDING_KEY]: JSON.stringify([pendingBody]) });
  const queue = createFeedbackQueue({
    storage,
    submit: async () => {
      throw apiError(422);
    },
  });

  assert.deepEqual(await queue.flush(), { sent: 0, kept: 0 });
  assert.equal(storage.items.has(FEEDBACK_PENDING_KEY), false);
});
