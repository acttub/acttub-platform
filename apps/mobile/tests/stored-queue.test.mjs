import assert from 'node:assert/strict';
import test from 'node:test';

import { createUploadQueue, LIBRARY_QUEUE_TTL_MS } from '../lib/library/upload-queue.ts';
import { createRecordingQueue, RECORDING_QUEUE_TTL_MS } from '../lib/reading/recording-queue.ts';
import { dropStale, storedList } from '../lib/stored-queue.ts';

const NOW = 10_000_000_000;

function memory() {
  const items = new Map();
  return {
    items,
    getItem: async (k) => items.get(k) ?? null,
    setItem: async (k, v) => void items.set(k, v),
    removeItem: async (k) => void items.delete(k),
  };
}

test('dropStale: 경계 시각보다 먼저 들어온 것만, 고른 것만 파일을 지우고 뺀다 — 파일 지우기가 실패해도 뺀다', async () => {
  const deleted = [];
  const list = [
    { uri: 'old', createdAt: 99 },
    { uri: 'edge', createdAt: 100 },
    { uri: 'other', createdAt: 1, skip: true },
    { uri: 'broken', createdAt: 5 },
  ];
  const { stale, fresh } = await dropStale(list, 100, async (uri) => {
    deleted.push(uri);
    if (uri === 'broken') throw new Error('io');
  }, (e) => !e.skip);
  assert.deepEqual(stale.map((e) => e.uri), ['old', 'broken']);
  assert.deepEqual(fresh.map((e) => e.uri), ['edge', 'other']);
  assert.deepEqual(deleted, ['old', 'broken']);
});

test('storedList: 깨진 값은 빈 목록이고, 비면 칸을 지운다', async () => {
  const storage = memory();
  let changes = 0;
  const q = storedList(storage, 'k', () => (changes += 1));
  storage.items.set('k', '{not json');
  assert.deepEqual(await q.read(), []);
  await q.write([{ a: 1 }]);
  assert.equal(storage.items.get('k'), '[{"a":1}]');
  await q.write([]);
  assert.equal(storage.items.has('k'), false);
  assert.equal(changes, 2);
});

test('녹음 큐: 7일이 막 지난 녹음만 지우고, 딱 7일 된 것은 올린다', async () => {
  const storage = memory();
  const deleted = [];
  const sent = [];
  const queue = createRecordingQueue({
    storage,
    now: () => NOW,
    upload: async (e) => void sent.push(e.uri),
    deleteFile: async (uri) => void deleted.push(uri),
  });
  const entry = (uri, createdAt) => ({ requestId: uri, sessionId: 's', lineId: uri, attemptNo: 1, uri, contentType: 'audio/m4a', durationMs: 1, transcript: null, transcriptSource: 'none', createdAt });
  await queue.enqueue(entry('stale', NOW - RECORDING_QUEUE_TTL_MS - 1));
  await queue.enqueue(entry('edge', NOW - RECORDING_QUEUE_TTL_MS));
  assert.deepEqual(await queue.flush(), { sent: 1, dropped: 1, failed: 0 });
  assert.deepEqual(sent, ['edge']);
  // 버린 녹음과 올린 녹음의 기기 파일이 지워진다.
  assert.deepEqual(deleted, ['stale', 'edge']);
});

test('보관함 큐: 7일 지난 영상은 그 계정 것만 지우고, 다른 계정 것은 건드리지 않는다', async () => {
  const storage = memory();
  const deleted = [];
  const discarded = [];
  const queue = createUploadQueue({
    storage,
    now: () => NOW,
    prepare: async () => {
      throw Object.assign(new Error('offline'), { retryable: true });
    },
    intent: async () => assert.fail('올리지 않는다'),
    put: async () => 'uploaded',
    complete: async () => assert.fail('올리지 않는다'),
    deleteFile: async (uri) => void deleted.push(uri),
    onDiscarded: (entries) => discarded.push(...entries.map((e) => e.uri)),
  });
  const entry = (id, owner, createdAt) => ({ id, owner, requestId: id, uri: id, contentType: 'video/mp4', durationMs: 1, createdAt });
  await queue.enqueue(entry('mine-old', 'u1', NOW - LIBRARY_QUEUE_TTL_MS - 1));
  await queue.enqueue(entry('mine-edge', 'u1', NOW - LIBRARY_QUEUE_TTL_MS));
  await queue.enqueue(entry('theirs-old', 'u2', NOW - LIBRARY_QUEUE_TTL_MS - 1));
  const result = await queue.flush('u1');
  assert.equal(result.discarded, 1);
  assert.deepEqual(discarded, ['mine-old']);
  assert.deepEqual(deleted, ['mine-old']);
  assert.deepEqual((await queue.pending('u1')).map((e) => e.id), ['mine-edge']);
  assert.deepEqual((await queue.pending('u2')).map((e) => e.id), ['theirs-old']);
});
