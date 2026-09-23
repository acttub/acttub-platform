import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { createProgressQueue } from '../lib/reading/progress-queue.ts';

function server({ failFirst = 0, closed = false } = {}) {
  const state = { received: [], seq: 0, current: null, failures: failFirst };
  const send = async (body) => {
    if (state.failures > 0) {
      state.failures -= 1;
      throw new NetworkError();
    }
    if (closed) throw new ApiError(409, 'session_closed', 'session_closed', 'session_closed');
    state.received.push(body);
    if (body.progress_seq > state.seq) {
      state.seq = body.progress_seq;
      state.current = body.current_line_id ?? state.current;
    }
    return { current_line_id: state.current, elapsed_seconds: body.elapsed_seconds ?? 0, progress_seq: state.seq, status: 'in_progress' };
  };
  return { state, send };
}

const tick = () => new Promise((r) => setImmediate(r));

test('reading.session: 줄이 바뀔 때마다 순번을 1씩 늘려 진행을 저장한다', async () => {
  const { state, send } = server();
  const q = createProgressQueue({ send, retryDelayMs: 0 });
  q.push({ current_line_id: 'l2', elapsed_seconds: 3 });
  await q.flushed();
  q.push({ current_line_id: 'l4', elapsed_seconds: 7 });
  await q.flushed();
  assert.deepEqual(state.received.map((b) => [b.progress_seq, b.current_line_id]), [[1, 'l2'], [2, 'l4']]);
});

test('reading.session: 저장이 실패하면 기기는 계속 진행하고 마지막 위치를 들고 있다가 다음 저장 때 보낸다(합쳐서)', async () => {
  const { state, send } = server({ failFirst: 1 });
  const q = createProgressQueue({ send, retryDelayMs: 0 });
  q.push({ current_line_id: 'l2', elapsed_seconds: 3 });
  q.push({ current_line_id: 'l4', elapsed_seconds: 8 });
  await q.flushed();
  assert.equal(state.current, 'l4');
  assert.ok(state.received.length >= 1);
  assert.equal(state.received.at(-1).current_line_id, 'l4', '마지막 위치가 이긴다');
  assert.equal(q.pending(), null);
});

test('reading.session: 뒤늦게 온 옛 요청(seq 5)은 최신(seq 7)을 덮지 못한다 — 서버가 무시하고 큐도 낮은 순번을 만들지 않는다', async () => {
  const { state, send } = server();
  const q = createProgressQueue({ send, retryDelayMs: 0 });
  for (let i = 0; i < 7; i++) {
    q.push({ current_line_id: `l${i}` });
    await q.flushed();
  }
  assert.equal(state.seq, 7);
  const late = await send({ progress_seq: 5, current_line_id: 'l10' });
  assert.equal(late.current_line_id, 'l6');
  assert.equal(late.progress_seq, 7);
});

test('reading.session: completed·stopped 회차에 진행 저장은 409 session_closed 이고 큐는 버린다', async () => {
  const { send } = server({ closed: true });
  let closed = 0;
  const q = createProgressQueue({ send, retryDelayMs: 0, onClosed: () => (closed += 1) });
  q.push({ current_line_id: 'l2' });
  await q.flushed();
  assert.equal(closed, 1);
  assert.equal(q.pending(), null);
});

test('reading.session: 완료 저장은 complete 와 line_results 를 함께 싣는다', async () => {
  const { state, send } = server();
  const q = createProgressQueue({ send, retryDelayMs: 0 });
  q.push({ current_line_id: null, elapsed_seconds: 42, complete: true, line_results: [{ line_id: 'l1', outcome: 'passed', misses: 0 }] });
  await q.flushed();
  assert.equal(state.received[0].complete, true);
  assert.deepEqual(state.received[0].line_results, [{ line_id: 'l1', outcome: 'passed', misses: 0 }]);
  await tick();
});
