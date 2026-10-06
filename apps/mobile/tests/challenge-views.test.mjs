import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIEW_THRESHOLD_MS,
  createViewTracker,
  entryStatusLabel,
  shouldCountView,
} from '../lib/challenge/views.ts';

const signal = (over = {}) => ({
  elapsedMs: 3_500,
  isOwn: false,
  isRepeat: false,
  alreadySent: false,
  ...over,
});

test('challenge.browse: 3초 이상 재생한 사건만 조회수가 된다', () => {
  assert.equal(VIEW_THRESHOLD_MS, 3_000);
  assert.equal(shouldCountView(signal({ elapsedMs: 3_000 })), true);
  assert.equal(shouldCountView(signal({ elapsedMs: 2_000 })), false);
});

test('challenge.browse: 본인 재생·자동 반복은 세지 않는다', () => {
  assert.equal(shouldCountView(signal({ isOwn: true })), false);
  assert.equal(shouldCountView(signal({ isRepeat: true })), false);
});

test('challenge.browse: 한 재생에 한 번만 보내고 같은 사건은 다시 보내지 않는다', async () => {
  const sent = [];
  let n = 0;
  const tracker = createViewTracker({
    send: async (entryId, eventId) => void sent.push([entryId, eventId]),
    newEventId: () => `event-${(n += 1)}`,
  });

  assert.equal(await tracker.onProgress('entry-1', signal()), true);
  assert.equal(await tracker.onProgress('entry-1', signal({ elapsedMs: 9_000 })), false);
  assert.deepEqual(sent, [['entry-1', 'event-1']]);

  // 떠났다 다시 열면 새 재생이라 새 사건 id 다.
  tracker.leave('entry-1');
  assert.equal(await tracker.onProgress('entry-1', signal()), true);
  assert.deepEqual(sent[1], ['entry-1', 'event-2']);
});

test('challenge.browse: 조회수 요청이 실패해도 재생은 그대로다', async () => {
  const tracker = createViewTracker({
    send: async () => {
      throw Object.assign(new Error('offline'), { name: 'NetworkError' });
    },
    newEventId: () => 'event-x',
  });

  assert.equal(await tracker.onProgress('entry-1', signal()), false);
});

test('challenge.browse: P03 카드는 비공개·확인 중을 그대로 말하고 공개는 조회·좋아요를 보여 준다', () => {
  const base = { category: 'public', view_count: 12, like_count: 3 };

  assert.match(entryStatusLabel(base), /12/);
  assert.match(entryStatusLabel(base), /3/);
  assert.match(entryStatusLabel({ ...base, category: 'private' }), /비공개/);
  assert.match(entryStatusLabel({ ...base, category: 'under_review' }), /확인 중/);
});
