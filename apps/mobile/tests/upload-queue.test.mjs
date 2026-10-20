import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError, RequestAbortError } from '../lib/api-request.ts';
import { LIBRARY_QUEUE_KEY, createUploadQueue } from '../lib/library/upload-queue.ts';

// practice.record 의 업로드 대기 큐 — 저장소·압축·영상 API·파일 삭제만 흉내 내고 큐 규칙은 그대로 돈다.
const NOW = Date.parse('2026-10-20T12:00:00Z');
const unprocessable = (code) => new ApiError(422, code, code, code);
const video = (intentId) => ({ id: `vid_${intentId}`, duration_ms: 3_000, byte_size: 5_000_000, content_type: 'video/mp4', favorite: false, purged_at: null, created_at: new Date(NOW).toISOString(), usage: { practice_count: 0, entry_count: 0 }, playback_url: null, playback_expires_at: null, poster_url: null });

function phone(overrides = {}) {
  const items = new Map();
  const log = [];
  let seq = 0;
  const deps = {
    storage: {
      getItem: async (k) => items.get(k) ?? null,
      setItem: async (k, v) => void items.set(k, v),
      removeItem: async (k) => void items.delete(k),
    },
    now: () => NOW,
    prepare: async (entry) => ({ uri: `${entry.uri}.small`, byteSize: 5_000_000, contentType: entry.contentType }),
    intent: async () => {
      seq += 1;
      log.push(`intent int_${seq}`);
      return { intent_id: `int_${seq}`, upload_url: `https://s3/int_${seq}`, expires_at: new Date(NOW + 1_800_000).toISOString() };
    },
    put: async (url) => { log.push(`put ${url}`); return 'uploaded'; },
    complete: async (intentId, requestId) => { log.push(`complete ${intentId} ${requestId}`); return video(intentId); },
    cleanup: async (prepared) => { log.push(`cleanup ${prepared.uri}`); },
    deleteFile: async (uri) => { log.push(`delete ${uri}`); },
    onFailed: (entry, code) => log.push(`failed ${entry.requestId} ${code}`),
    ...overrides,
  };
  const entry = (n, extra = {}) => ({ id: `local-${n}`, owner: 'u1', requestId: `rid-${n}`, uri: `file:///docs/archive/rec-${n}.mp4`, contentType: 'video/mp4', durationMs: 3_000, createdAt: NOW, ...extra });
  return { items, log, deps, entry, queue: () => createUploadQueue(deps) };
}

const stored = (p) => JSON.parse(p.items.get(LIBRARY_QUEUE_KEY) ?? '[]');

test('practice.record: 저장된 큐가 깨졌거나 목록이 아니면 빈 큐로 본다', async () => {
  const p = phone();
  p.items.set(LIBRARY_QUEUE_KEY, '{broken');
  assert.deepEqual(await p.queue().pending('u1'), []);
  p.items.set(LIBRARY_QUEUE_KEY, JSON.stringify({ id: 'local-1' }));
  assert.deepEqual(await p.queue().pending('u1'), []);
});

test('practice.record: 올리는 중 연결이 끊기면(시간 초과·5xx) 대기로 남기고 나머지는 다음 flush 로 미룬다', async () => {
  for (const error of [new RequestAbortError('timeout'), new ApiError(503, 'unavailable')]) {
    const p = phone({ intent: async () => { throw error; } });
    const q = p.queue();
    await q.enqueue(p.entry(1));
    await q.enqueue(p.entry(2));
    assert.deepEqual(await q.flush('u1'), { uploaded: 0, failed: 2, discarded: 0 });
    assert.deepEqual(stored(p).map((e) => [e.id, e.status, e.lastError]), [
      ['local-1', 'queued', error.name],
      ['local-2', 'queued', null],
    ]);
  }
});

test('practice.record: 연결이 아닌 오류는 실패로 남기고 다음 항목을 이어 올린다', async () => {
  let first = true;
  const p = phone({
    intent: async () => {
      if (first) { first = false; throw new ApiError(400, 'bad request'); }
      return { intent_id: 'int_9', upload_url: 'https://s3/int_9', expires_at: new Date(NOW + 1_800_000).toISOString() };
    },
  });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.enqueue(p.entry(2));
  assert.deepEqual(await q.flush('u1'), { uploaded: 1, failed: 1, discarded: 0 });
  assert.deepEqual(stored(p).map((e) => [e.id, e.status, e.lastError]), [['local-1', 'failed', 'ApiError']]);
});

test('practice.record: Error 가 아닌 것이 던져지면 사유를 error 로 적는다', async () => {
  const p = phone({ put: async () => { throw 'socket closed'; } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.flush('u1');
  assert.deepEqual(stored(p).map((e) => [e.status, e.lastError]), [['failed', 'error']]);
});

test('practice.record: 동의가 없거나(403) 자리가 없으면(404) 다시 보내도 같아 항목과 파일을 버린다', async () => {
  for (const [error, code] of [[new ApiError(403, 'consent', 'consent_required'), 'rejected'], [unprocessable('video_not_ready'), 'video_not_ready']]) {
    const p = phone({ complete: async () => { throw error; } });
    const q = p.queue();
    await q.enqueue(p.entry(1));
    assert.deepEqual(await q.flush('u1'), { uploaded: 0, failed: 1, discarded: 0 });
    assert.deepEqual(await q.pending('u1'), []);
    assert.ok(p.log.includes(`failed rid-1 ${code}`));
    assert.ok(p.log.includes('delete file:///docs/archive/rec-1.mp4'));
  }
});

test('practice.record: 올리기가 취소되면 대기로 돌려 다음에 다시 올린다', async () => {
  let cancelled = true;
  const p = phone({ put: async (url) => { p.log.push(`put ${url}`); return cancelled ? 'cancelled' : 'uploaded'; } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  assert.deepEqual(await q.flush('u1'), { uploaded: 0, failed: 1, discarded: 0 });
  assert.deepEqual(stored(p).map((e) => [e.status, e.intentId]), [['queued', 'int_1']]);
  cancelled = false;
  assert.deepEqual(await q.flush('u1'), { uploaded: 1, failed: 0, discarded: 0 });
});

test('practice.record: 저장된 자리의 만료 시각을 읽을 수 없으면 새 자리를 받는다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  p.items.set(LIBRARY_QUEUE_KEY, JSON.stringify(stored(p).map((e) => ({ ...e, intentId: 'int_old', intentExpiresAt: 'not-a-date' }))));
  await q.flush('u1');
  assert.deepEqual(p.log.filter((line) => line.startsWith('intent') || line.startsWith('complete')), ['intent int_1', 'complete int_1 rid-1']);
});

test('practice.record: 압축본은 올린 뒤 지우고, 지우다 실패해도 결과는 같다', async () => {
  const p = phone({ cleanup: async (prepared) => { p.log.push(`cleanup ${prepared.uri}`); throw new Error('busy'); } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  assert.deepEqual(await q.flush('u1'), { uploaded: 1, failed: 0, discarded: 0 });
  assert.deepEqual(p.log, [
    'intent int_1',
    'put https://s3/int_1',
    'complete int_1 rid-1',
    'cleanup file:///docs/archive/rec-1.mp4.small',
  ]);
});

test('practice.record: 압축이 이유 없이 실패하면 올릴 수 없어 버리고, 일시 거절(총량)이면 실패로 남긴다', async () => {
  const p = phone({ prepare: async () => { throw new Error('codec'); } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  assert.deepEqual(await q.flush('u1'), { uploaded: 0, failed: 1, discarded: 0 });
  assert.deepEqual(await q.pending('u1'), []);
  assert.deepEqual(p.log, ['failed rid-1 prepare_failed', 'delete file:///docs/archive/rec-1.mp4']);

  const quota = phone({ prepare: async () => { throw unprocessable('video_quota'); } });
  const q2 = quota.queue();
  await q2.enqueue(quota.entry(1));
  await q2.flush('u1');
  assert.deepEqual(stored(quota).map((e) => [e.status, e.lastError]), [['failed', 'video_quota']]);
});

test('practice.record: 자리가 두 번 연속 만료되면 그 오류로 실패로 남긴다', async () => {
  const p = phone({ complete: async () => { throw unprocessable('upload_expired'); } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  assert.deepEqual(await q.flush('u1'), { uploaded: 0, failed: 1, discarded: 0 });
  assert.deepEqual(stored(p).map((e) => [e.status, e.lastError]), [['failed', 'upload_expired']]);
  assert.equal(p.log.filter((line) => line.startsWith('intent')).length, 2);
});

test('practice.record: 큐에 없는 항목을 지워도 파일은 건드리지 않는다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.remove('local-9');
  assert.equal((await q.pending('u1')).length, 1);
  assert.deepEqual(p.log, []);
});

test('practice.record: 오프라인(NetworkError)이면 대기로 남긴다', async () => {
  const p = phone({ intent: async () => { throw new NetworkError(); } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.flush('u1');
  assert.deepEqual(stored(p).map((e) => [e.status, e.lastError]), [['queued', 'NetworkError']]);
});
