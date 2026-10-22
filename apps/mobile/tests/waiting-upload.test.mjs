import assert from 'node:assert/strict';
import test from 'node:test';

import { createWaitingUploadStore, waitingState } from '../lib/practice/waiting-upload.ts';

const base = {
  owner: 'u1',
  pendingId: 'lib-1',
  videoId: null,
  requestId: 'r1',
  continueFrom: null,
  scene: { situation: '', character: '', goal: '' },
  blockage: { category: null, detail: null, note: '' },
  savedAt: 1,
};

function memory() {
  const m = new Map();
  return {
    m,
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
}

test('waitingState: 큐 항목과 확정 영상으로 단계를 정한다', () => {
  assert.equal(waitingState(base, { status: 'queued' }, null), 'uploading');
  assert.equal(waitingState(base, { status: 'uploading' }, null), 'uploading');
  assert.equal(waitingState(base, { status: 'failed' }, null), 'failed');
  assert.equal(waitingState(base, null, 'v1'), 'ready');
  assert.equal(waitingState({ videoId: 'v1' }, null, null), 'ready');
  assert.equal(waitingState(base, null, null), 'gone');
});

test('store: 저장·불러오기·지우기, 깨진 기록은 버린다', async () => {
  const storage = memory();
  const store = createWaitingUploadStore(storage);
  assert.equal(await store.load('u1'), null);
  await store.save(base);
  assert.deepEqual(await store.load('u1'), base);
  assert.equal(await store.load('u2'), null);
  await store.clear('u1');
  assert.equal(await store.load('u1'), null);
  storage.m.set('acttub.waitingUpload:u1', '{bad');
  assert.equal(await store.load('u1'), null);
  assert.equal(storage.m.size, 0);
  storage.m.set('acttub.waitingUpload:u1', JSON.stringify({ owner: 'u1' }));
  assert.equal(await store.load('u1'), null);
  assert.equal(storage.m.size, 0);
});
