import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { RETIRED_SEND_ATTEMPTS, closeProgressQueue, createProgressQueue, openProgressQueue } from '../lib/reading/progress-queue.ts';

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

test('reading.session: completed 회차에 진행 저장은 409 session_closed 이고 큐는 버린다', async () => {
  const { send } = server({ closed: true });
  let closed = 0;
  const q = createProgressQueue({ send, retryDelayMs: 0, onClosed: () => (closed += 1) });
  q.push({ current_line_id: 'l2' });
  await q.flushed();
  assert.equal(closed, 1);
});

test('reading.session: 완료 저장은 complete 와 말한 것(line_results)을 함께 싣는다', async () => {
  const { state, send } = server();
  const q = createProgressQueue({ send, retryDelayMs: 0 });
  q.push({ current_line_id: null, elapsed_seconds: 42, complete: true, line_results: [{ line_id: 'l1', said: '여기 있을 줄 알았어' }] });
  await q.flushed();
  assert.equal(state.received[0].complete, true);
  assert.deepEqual(state.received[0].line_results, [{ line_id: 'l1', said: '여기 있을 줄 알았어' }]);
  await tick();
});

function flakyServer() {
  const net = { online: false, seq: 3, status: 'in_progress', received: [], calls: 0 };
  const send = async (body) => {
    net.calls += 1;
    if (!net.online) throw new NetworkError();
    if (net.status === 'completed') throw new ApiError(409, 'session_closed', 'session_closed', 'session_closed');
    net.received.push(body);
    if (body.progress_seq > net.seq) {
      net.seq = body.progress_seq;
      if (body.complete) net.status = 'completed';
    }
    return { current_line_id: null, elapsed_seconds: 0, progress_seq: net.seq, status: net.status, different_lines: [] };
  };
  return { net, send };
}

test('reading.session: 끊긴 채 끝내고 나간 회차를 다시 열면 남은 완료 저장은 버리고 새 화면의 저장만 간다 — 409 로 튕기지 않는다', async () => {
  const { net, send } = flakyServer();
  const first = openProgressQueue('S', { send, initialSeq: 3, retryDelayMs: 1, maxRetryDelayMs: 1 });
  first.push({ current_line_id: null, complete: true, line_results: [{ line_id: 'l2', said: '하나' }] });
  await new Promise((r) => setTimeout(r, 10));
  closeProgressQueue('S', first, { keepSending: true });

  let closed = 0;
  const second = openProgressQueue('S', { send, initialSeq: 3, retryDelayMs: 1, maxRetryDelayMs: 1, onClosed: () => (closed += 1) });
  net.online = true;
  second.push({ current_line_id: 'l4', elapsed_seconds: 9 });
  await second.flushed();
  await new Promise((r) => setTimeout(r, 20));
  second.push({ current_line_id: 'l6', elapsed_seconds: 12 });
  await second.flushed();

  assert.equal(closed, 0);
  assert.equal(net.status, 'in_progress');
  assert.deepEqual(net.received.map((b) => [b.current_line_id, b.complete ?? false]), [['l4', false], ['l6', false]]);
  closeProgressQueue('S', second, { keepSending: false });
});

test('reading.session: 화면을 떠난 뒤에도 보내는 완료 저장은 끊긴 채면 정해진 횟수만 다시 보내고 그만둔다', async () => {
  const { net, send } = flakyServer();
  const q = openProgressQueue('T', { send, retryDelayMs: 0, maxRetryDelayMs: 0 });
  q.push({ current_line_id: null, complete: true });
  await tick();
  closeProgressQueue('T', q, { keepSending: true });
  await q.flushed();
  const calls = net.calls;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(net.calls, calls, '그만둔 뒤에는 보내지 않는다');
  assert.equal(calls, RETIRED_SEND_ATTEMPTS);
});
