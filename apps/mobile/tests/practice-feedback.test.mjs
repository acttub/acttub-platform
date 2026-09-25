import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEEDBACK_PENDING_KEY,
  bodyTooLong,
  buildFeedbackBody,
  contactTooLong,
  createFeedbackQueue,
  isDismissed,
  shouldOfferFeedback,
} from '../lib/practice/feedback.ts';
import { FEEDBACK_BODY_MAX, FEEDBACK_CONTACT_MAX } from '../lib/practice/types.ts';

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

test('practice.feedback: 대화에서 x로 나가며 보내면 화면·계기·본문이 그대로 실린다', () => {
  const body = buildFeedbackBody({
    requestId: 'req-1',
    practiceId: 'practice-1',
    screen: 'coach',
    trigger: 'x',
    text: '  질문이   좋았어요  ',
    contactEmail: ' me@example.com ',
  });

  assert.deepEqual(body, {
    request_id: 'req-1',
    practice_id: 'practice-1',
    screen: 'coach',
    trigger: 'x',
    body: '질문이 좋았어요',
    contact_email: 'me@example.com',
  });
  assert.equal(isDismissed(body), false);
});

test('practice.feedback: 노트 화면의 leave·back 도 그 값으로 저장된다', () => {
  for (const trigger of ['leave', 'back']) {
    const body = buildFeedbackBody({ requestId: 'r', practiceId: 'p', screen: 'report', trigger, text: '좋아요' });
    assert.equal(body.screen, 'report');
    assert.equal(body.trigger, trigger);
  }
});

test('practice.feedback: 그냥 나가기는 본문 없는 행으로 남는다', () => {
  const body = buildFeedbackBody({ requestId: 'req-2', practiceId: 'practice-1', screen: 'coach', trigger: 'back' });

  assert.equal(isDismissed(body), true);
  assert.equal('body' in body, false);
  assert.equal('contact_email' in body, false);
});

test('practice.feedback: 본문 100자는 보내고 101자는 막으며 연락처는 80자까지다', () => {
  assert.equal(FEEDBACK_BODY_MAX, 100);
  assert.equal(FEEDBACK_CONTACT_MAX, 80);
  assert.equal(bodyTooLong('가'.repeat(100)), false);
  assert.equal(bodyTooLong('가'.repeat(101)), true);
  // 이모지 하나는 한 글자로 센다(코드 포인트).
  assert.equal(bodyTooLong('🙂'.repeat(100)), false);
  assert.equal(contactTooLong('a'.repeat(80)), false);
  assert.equal(contactTooLong('a'.repeat(81)), true);
});

test('practice.feedback: 오프라인이거나 다른 기기가 선점했으면 시트를 띄우지 않는다', () => {
  assert.equal(shouldOfferFeedback({ online: true, claimedNow: true }), true);
  assert.equal(shouldOfferFeedback({ online: false, claimedNow: true }), false);
  assert.equal(shouldOfferFeedback({ online: true, claimedNow: false }), false);
});

test('practice.feedback: 오프라인 제출은 들고 있다가 다시 보내고 같은 요청 id 라 행이 하나다', async () => {
  const storage = memoryStorage();
  let online = false;
  const seen = [];
  const queue = createFeedbackQueue({
    storage,
    submit: async (body) => {
      if (!online) throw Object.assign(new Error('offline'), { name: 'NetworkError' });
      seen.push(body.request_id);
    },
  });
  const body = buildFeedbackQueueBody();

  assert.equal(await queue.send(body), 'queued');
  assert.equal(storage.items.has(FEEDBACK_PENDING_KEY), true);
  // 같은 것을 또 넣어도 한 건이다.
  await queue.send(body);

  online = true;
  const result = await queue.flush();
  assert.deepEqual(result, { sent: 1, kept: 0 });
  assert.deepEqual(seen, ['req-3']);
  assert.equal(storage.items.has(FEEDBACK_PENDING_KEY), false);
});

test('practice.feedback: 서버가 형식을 거절하면(422) 들고 있지 않는다 — 나가기를 막지 않는다', async () => {
  const storage = memoryStorage();
  const queue = createFeedbackQueue({
    storage,
    submit: async () => {
      throw apiError(422);
    },
  });

  assert.equal(await queue.send(buildFeedbackQueueBody()), 'dropped');
  assert.equal(storage.items.has(FEEDBACK_PENDING_KEY), false);
});

function buildFeedbackQueueBody() {
  return buildFeedbackBody({
    requestId: 'req-3',
    practiceId: 'practice-1',
    screen: 'coach',
    trigger: 'leave',
    text: '한 줄 남겨요',
  });
}
