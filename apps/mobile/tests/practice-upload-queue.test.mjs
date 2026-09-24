import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { LIBRARY_QUEUE_KEY, LIBRARY_QUEUE_TTL_MS, createUploadQueue } from '../lib/library/upload-queue.ts';

const DAY = 86_400_000;
const unprocessable = (code) => new ApiError(422, code, code, code, { detail: code });

/** 촬영본이 든 폰과 영상 API(올릴 자리 · 올리기 · 마무리) 흉내. 예약 장부는 request_id 로 멱등하다. */
function phone({ failures = {}, now = 10_000_000, prepareFails = null } = {}) {
  const items = new Map();
  const disk = new Set();
  const server = { intents: new Map(), byRequest: new Map(), videos: new Map(), puts: [], completes: [], intentCalls: 0 };
  const clock = { now };
  let seq = 0;
  const storage = {
    getItem: async (k) => items.get(k) ?? null,
    setItem: async (k, v) => void items.set(k, v),
    removeItem: async (k) => void items.delete(k),
  };
  const deps = {
    storage,
    now: () => clock.now,
    prepare: async (entry) => {
      if (prepareFails) throw prepareFails;
      return { uri: entry.uri, byteSize: 5_000_000, contentType: entry.contentType };
    },
    intent: async (entry) => {
      server.intentCalls += 1;
      if (failures.intent?.length) {
        const f = failures.intent.shift();
        if (f) throw f;
      }
      const existing = server.byRequest.get(entry.requestId);
      if (existing?.video) return { intent_id: existing.id, upload_url: `https://s3/${existing.id}`, expires_at: new Date(clock.now + 1_800_000).toISOString() };
      const id = existing?.id ?? `int_${++seq}`;
      server.intents.set(id, { id, requestId: entry.requestId, video: null });
      server.byRequest.set(entry.requestId, server.intents.get(id));
      return { intent_id: id, upload_url: `https://s3/${id}`, expires_at: new Date(clock.now + 1_800_000).toISOString() };
    },
    put: async (url) => {
      server.puts.push(url);
      if (failures.put?.length) {
        const f = failures.put.shift();
        if (f) throw f;
      }
      return 'uploaded';
    },
    complete: async (intentId, requestId) => {
      server.completes.push([intentId, requestId]);
      const failure = failures.complete?.length ? failures.complete.shift() : null;
      // 422 는 서버가 거절한 것이고, NetworkError 는 서버는 확정했는데 응답만 유실된 것으로 흉내 낸다.
      if (failure instanceof ApiError && failure.status !== 0) throw failure;
      const intent = server.intents.get(intentId);
      if (!intent) throw unprocessable('upload_expired');
      if (!intent.video) {
        intent.video = { id: `vid_${intentId}`, duration_ms: 3_000, byte_size: 5_000_000, content_type: 'video/mp4', favorite: false, purged_at: null, created_at: new Date(clock.now).toISOString(), usage: { practice_count: 0, entry_count: 0 }, playback_url: null, playback_expires_at: null, poster_url: null };
        server.videos.set(intent.video.id, intent.video);
      }
      if (failure) throw failure;
      return intent.video;
    },
    deleteFile: async (uri) => void disk.delete(uri),
    onUploaded: (entry, video) => events.push(['uploaded', entry.requestId, video.id]),
    onDiscarded: (entries) => events.push(['discarded', entries.length]),
    onFailed: (entry, code) => events.push(['failed', entry.requestId, code]),
  };
  const events = [];
  const entry = (n, overrides = {}) => {
    const uri = `file:///docs/archive/rec-${n}.mp4`;
    disk.add(uri);
    return { id: `local-${n}`, owner: 'u1', requestId: `rid-${n}`, uri, contentType: 'video/mp4', durationMs: 3_000, createdAt: clock.now, ...overrides };
  };
  return { items, disk, server, deps, clock, events, entry, queue: () => createUploadQueue(deps) };
}

test('practice.record: 촬영 뒤 올릴 자리 받기 · 올리기 · 마무리를 지나면 videos 행이 하나 생기고 큐가 빈다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  assert.deepEqual((await q.pending('u1')).map((e) => e.status), ['queued'], '마무리 전에는 "기기에 저장 · 업로드 대기"');
  const result = await q.flush('u1');
  assert.deepEqual(result, { uploaded: 1, failed: 0, discarded: 0 });
  assert.equal(p.server.videos.size, 1);
  assert.deepEqual(p.server.completes, [['int_1', 'rid-1']]);
  assert.deepEqual(await q.pending('u1'), []);
  assert.equal(p.events[0][0], 'uploaded');
  assert.ok(p.disk.has('file:///docs/archive/rec-1.mp4'), '기기 파일은 큐가 지우지 않는다(보관함 복사본)');
});

test('practice.record: 오프라인이면 큐가 남고 앱을 다시 열어도(새 인스턴스) 같은 요청 id로 이어 올려 행은 하나다', async () => {
  const p = phone({ failures: { intent: [new NetworkError()] } });
  await p.queue().enqueue(p.entry(1));
  const first = await p.queue().flush('u1');
  assert.deepEqual(first, { uploaded: 0, failed: 1, discarded: 0 });
  assert.ok(p.items.get(LIBRARY_QUEUE_KEY)?.includes('rid-1'));
  const second = await p.queue().flush('u1');
  assert.deepEqual(second, { uploaded: 1, failed: 0, discarded: 0 });
  assert.equal(p.server.videos.size, 1);
});

test('practice.record: 마무리 응답만 유실돼 같은 request_id로 다시 마무리하면 같은 영상이다', async () => {
  const p = phone({ failures: { complete: [new NetworkError()] } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.flush('u1');
  assert.equal(p.server.videos.size, 1, '서버는 이미 확정했다');
  await q.flush('u1');
  assert.equal(p.server.videos.size, 1, '행 하나');
  assert.equal(p.server.completes.length, 2);
  assert.equal(p.server.completes[0][1], p.server.completes[1][1], '같은 request_id');
  assert.deepEqual(await q.pending('u1'), []);
});

test('practice.record: 마무리 전에 앱이 죽어 자리가 만료됐으면(422 upload_expired) 처음부터 다시 올린다', async () => {
  const p = phone({ failures: { complete: [unprocessable('upload_expired')] } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  const result = await q.flush('u1');
  assert.deepEqual(result, { uploaded: 1, failed: 0, discarded: 0 });
  assert.equal(p.server.intentCalls, 2, '올릴 자리를 다시 받는다');
  assert.equal(p.server.puts.length, 2);
  assert.equal(p.server.videos.size, 1);
});

test('practice.record: 7일 지난 대기 파일은 버리고 알린다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1, { createdAt: p.clock.now - LIBRARY_QUEUE_TTL_MS - 1 }));
  await q.enqueue(p.entry(2));
  const result = await q.flush('u1');
  assert.deepEqual(result, { uploaded: 1, failed: 0, discarded: 1 });
  assert.ok(p.events.some(([k, n]) => k === 'discarded' && n === 1));
  assert.equal(p.disk.has('file:///docs/archive/rec-1.mp4'), false, '버린 파일은 지운다');
});

test('practice.record: 총량 초과(422 video_quota)면 기존은 두고 그 항목은 실패로 남아 정리 뒤 다시 올린다', async () => {
  const p = phone({ failures: { complete: [unprocessable('video_quota')] } });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  const result = await q.flush('u1');
  assert.deepEqual(result, { uploaded: 0, failed: 1, discarded: 0 });
  const [pending] = await q.pending('u1');
  assert.equal(pending.status, 'failed');
  assert.equal(pending.lastError, 'video_quota');
  const again = await q.flush('u1');
  assert.deepEqual(again, { uploaded: 1, failed: 0, discarded: 0 });
});

test('practice.record: 압축 결과가 한도를 넘거나 서버가 크기·길이를 거절하면(video_too_large·video_too_long) 항목을 버리고 알린다', async () => {
  const p = phone({ prepareFails: unprocessable('video_too_large') });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  const result = await q.flush('u1');
  assert.deepEqual(result, { uploaded: 0, failed: 1, discarded: 0 });
  assert.deepEqual(await q.pending('u1'), []);
  assert.ok(p.events.some(([k, , code]) => k === 'failed' && code === 'video_too_large'));
});

test('practice.record: 큐는 계정별이다 — 다른 계정의 대기 항목은 올리지도 보이지도 않는다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.enqueue(p.entry(2, { owner: 'u2' }));
  assert.equal((await q.pending('u1')).length, 1);
  const result = await q.flush('u1');
  assert.deepEqual(result, { uploaded: 1, failed: 0, discarded: 0 });
  assert.equal((await q.pending('u2')).length, 1, 'u2 의 것은 남아 있다');
});

test('practice.record: 항목을 지우면 파일도 지우고 큐에서 뺀다', async () => {
  const p = phone();
  const q = p.queue();
  const e = p.entry(1);
  await q.enqueue(e);
  await q.remove(e.id);
  assert.deepEqual(await q.pending('u1'), []);
  assert.equal(p.disk.has(e.uri), false);
});
