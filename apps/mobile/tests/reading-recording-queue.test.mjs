import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { RECORDING_QUEUE_KEY, RECORDING_QUEUE_TTL_MS, createRecordingQueue } from '../lib/reading/recording-queue.ts';

const DAY = 86_400_000;

/** 녹음 파일이 있는 폰과 녹음 API 흉내. 서버는 request_id 로 멱등하고 같은 (회차, 줄)은 큰 attempt_no 가 대체한다. */
function phone({ failures = [], now = 1_000_000 } = {}) {
  const items = new Map();
  const disk = new Set();
  const server = { rows: new Map(), byRequest: new Map(), posts: [] };
  const clock = { now };
  let seq = 0;
  const deps = {
    storage: {
      getItem: async (k) => items.get(k) ?? null,
      setItem: async (k, v) => void items.set(k, v),
      removeItem: async (k) => void items.delete(k),
    },
    upload: async (entry) => {
      server.posts.push(entry);
      const failure = failures.shift();
      if (failure === 'network') throw new NetworkError();
      if (failure === 503) throw new ApiError(503, 'audio_conversion_failed', 'audio_conversion_failed', 'audio_conversion_failed');
      if (failure === 404) throw new ApiError(404, 'session_not_found', 'session_not_found', 'session_not_found');
      if (failure === 422) throw new ApiError(422, 'recording_too_long', 'recording_too_long', 'recording_too_long');
      const existing = server.byRequest.get(entry.requestId);
      if (existing) return existing;
      const key = `${entry.sessionId}:${entry.lineId}`;
      const prev = server.rows.get(key);
      if (prev && prev.attempt_no >= entry.attemptNo) return prev; // 작은 번호는 무시하고 현재 값
      const row = { id: `rec_${++seq}`, line_id: entry.lineId, attempt_no: entry.attemptNo, content_type: entry.contentType };
      server.rows.set(key, row);
      server.byRequest.set(entry.requestId, row);
      return row;
    },
    deleteFile: async (uri) => void disk.delete(uri),
    now: () => clock.now,
    retryDelayMs: 0,
  };
  const entry = (n, overrides = {}) => {
    const uri = `file:///cache/line-${n}.m4a`;
    disk.add(uri);
    return {
      requestId: `rid-${n}`,
      sessionId: 'ses_1',
      lineId: `l${n}`,
      attemptNo: 1,
      uri,
      contentType: 'audio/mp4',
      durationMs: 3_000,
      transcript: null,
      transcriptSource: 'none',
      matched: null,
      createdAt: clock.now,
      ...overrides,
    };
  };
  return { items, disk, server, deps, clock, entry, queue: () => createRecordingQueue(deps) };
}

test('reading.recording: 내 대사 둘을 말하면 줄마다 하나씩 올라가고(각 행의 line_id) 파일은 지워지며 큐가 빈다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.enqueue(p.entry(2));
  const result = await q.flush();
  assert.deepEqual(result, { sent: 2, dropped: 0, failed: 0 });
  assert.deepEqual([...p.server.rows.values()].map((r) => r.line_id), ['l1', 'l2']);
  assert.equal(p.disk.size, 0);
  assert.deepEqual(await q.pending(), []);
  assert.equal(p.items.has(RECORDING_QUEUE_KEY), false);
});

test('reading.recording: 같은 줄을 "다시"로 다시 말하면(attempt_no 2) 행은 하나이고 뒤 것이 남는다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.enqueue(p.entry(3, { lineId: 'l1', attemptNo: 2 }));
  await q.flush();
  assert.equal(p.server.rows.size, 1);
  assert.equal(p.server.rows.get('ses_1:l1').attempt_no, 2);
});

test('reading.recording: 변환 실패(503)는 같은 요청 id로 다시 시도하고 결국 행 하나·객체 하나다', async () => {
  const p = phone({ failures: [503] });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  const first = await q.flush();
  assert.deepEqual(first, { sent: 0, dropped: 0, failed: 1 });
  assert.equal((await q.pending()).length, 1, '파일과 요청 id를 들고 있다');
  const second = await q.flush();
  assert.deepEqual(second, { sent: 1, dropped: 0, failed: 0 });
  assert.equal(p.server.posts[0].requestId, p.server.posts[1].requestId);
  assert.equal(p.server.rows.size, 1);
});

test('reading.recording: 오프라인이면 큐가 남고 앱을 다시 열어도(새 큐 인스턴스) 이어서 올린다', async () => {
  const p = phone({ failures: ['network'] });
  await p.queue().enqueue(p.entry(1));
  await p.queue().flush();
  assert.ok(p.items.get(RECORDING_QUEUE_KEY)?.includes('rid-1'), '저장소에 남는다');
  const restarted = p.queue();
  const result = await restarted.flush();
  assert.deepEqual(result, { sent: 1, dropped: 0, failed: 0 });
});

test('reading.recording: 응답만 유실된 올리기를 재시도해도 같은 녹음 하나다', async () => {
  const p = phone();
  const q = p.queue();
  const e = p.entry(1);
  await q.enqueue(e);
  await q.flush();
  await q.enqueue({ ...e });
  await q.flush();
  assert.equal(p.server.rows.size, 1);
  assert.equal(p.server.posts.length, 2);
});

test('reading.recording: 대본·회차가 지워진 뒤 늦게 온 올리기(404)와 한도 422는 버리고 다시 보내지 않는다', async () => {
  const p = phone({ failures: [404, 422] });
  const q = p.queue();
  await q.enqueue(p.entry(1));
  await q.enqueue(p.entry(2));
  const result = await q.flush();
  assert.deepEqual(result, { sent: 0, dropped: 2, failed: 0 });
  assert.deepEqual(await q.pending(), []);
  assert.equal(p.disk.size, 0, '버린 파일도 지운다');
});

test('reading.recording: 7일 지난 파일은 올리지 않고 버린다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1, { createdAt: p.clock.now - RECORDING_QUEUE_TTL_MS - 1 }));
  await q.enqueue(p.entry(2, { createdAt: p.clock.now - DAY }));
  const result = await q.flush();
  assert.deepEqual(result, { sent: 1, dropped: 1, failed: 0 });
  assert.equal(p.server.posts.length, 1);
  assert.equal(p.server.posts[0].lineId, 'l2');
});

test('reading.recording: 큐는 한 번에 하나씩만 돌아 겹쳐 불러도 같은 항목을 두 번 보내지 않는다', async () => {
  const p = phone();
  const q = p.queue();
  await q.enqueue(p.entry(1));
  const [a, b] = await Promise.all([q.flush(), q.flush()]);
  assert.deepEqual(a, b, '도는 중에 부르면 같은 결과를 함께 기다린다');
  assert.equal(a.sent, 1);
  assert.equal(p.server.posts.length, 1, '같은 항목을 두 번 보내지 않는다');
});
