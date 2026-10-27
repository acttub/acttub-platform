import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiError,
  NetworkError,
  RequestAbortError,
  createApiRequestClient,
  friendlyError,
} from '../lib/api-request.ts';

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

const sseBody = events =>
  new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

/** 손으로 돌리는 시계. 대기 타이머는 runNext 로만 흐른다. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const timerId = nextId++;
      timers.set(timerId, { callback, at: now + delayMs });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    get pending() {
      return timers.size;
    },
    runNext() {
      const [timerId, timer] = [...timers.entries()].sort(([, a], [, b]) => a.at - b.at)[0] ?? [];
      if (!timer) return false;
      timers.delete(timerId);
      now = timer.at;
      timer.callback();
      return true;
    },
  };
}

/** 로그인 상태(토큰 둘·세션 epoch)와 갱신 저장·삭제 기록. */
function session({ access = 'access-old', refresh = 'refresh-old', clearResult = true } = {}) {
  const state = { access, refresh, epoch: 0, cleared: [], committed: [] };
  return {
    state,
    deps: {
      getAccessToken: () => state.access,
      getRefreshToken: () => state.refresh,
      getAuthSessionEpoch: () => state.epoch,
      setTokens: async (nextAccess, nextRefresh, expectation) => {
        state.committed.push({ nextAccess, nextRefresh, expectation });
        state.access = nextAccess;
        state.refresh = nextRefresh;
        return 'refreshed';
      },
      clearTokens: async expectation => {
        state.cleared.push(expectation);
        if (clearResult) {
          state.access = null;
          state.refresh = null;
        }
        return clearResult;
      },
    },
  };
}

function makeClient({ fetchImpl, streamFetchImpl, auth = session(), clock, extra = {} }) {
  const calls = [];
  const streamCalls = [];
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    clientHeader: 'app/test',
    fetchImpl: async (url, init) => {
      calls.push({ path: new URL(url).pathname, authorization: new Headers(init.headers).get('Authorization'), body: init.body });
      return fetchImpl(calls.length, url, init);
    },
    streamFetchImpl: streamFetchImpl
      ? async (url, init) => {
          streamCalls.push({ path: new URL(url).pathname, authorization: new Headers(init.headers).get('Authorization') });
          return streamFetchImpl(streamCalls.length, url, init);
        }
      : undefined,
    waitForCredentialReady: async () => {},
    emitConsentRequired: () => {},
    emitProfileRequired: () => {},
    emitAccountDeactivated: () => {},
    emitUpdateRequired: () => {},
    clock,
    random: () => 0,
    ...auth.deps,
    ...extra,
  });
  return { client, calls, streamCalls };
}

test('friendlyError: 401 은 로그인 만료, 413 은 너무 큰 영상 문구다', () => {
  assert.equal(friendlyError(401, { detail: 'unauthorized' }), '로그인이 만료됐어요. 다시 로그인해주세요.');
  assert.equal(friendlyError(413, null), '영상이 너무 커서 서버가 받지 못했어요. 구간을 잘라 더 작게 올려주세요.');
});

test('응답 본문을 읽다 연결이 끊기면(TypeError) 끊김 문구의 NetworkError', async () => {
  const { client } = makeClient({
    fetchImpl: () => ({ status: 200, ok: true, text: async () => { throw new TypeError('stream aborted'); } }),
  });
  const error = await client.request('/v2/me').catch(e => e);
  assert.ok(error instanceof NetworkError);
  assert.equal(error.message, '응답을 읽는 중 연결이 끊어졌어요. 다시 시도해 주세요.');
  assert.equal(error.code, 'network_error');
});

test('응답 본문 읽기의 다른 오류는 바꾸지 않고 올린다', async () => {
  const failure = new RangeError('decoder');
  const { client } = makeClient({ fetchImpl: () => ({ status: 200, ok: true, text: async () => { throw failure; } }) });
  await assert.rejects(client.request('/v2/me'), failure);
});

test('취소 신호를 단 요청도 자격증명 준비 실패를 그대로 올리고 요청을 보내지 않는다', async () => {
  const failure = new Error('keychain locked');
  const { client, calls } = makeClient({
    fetchImpl: () => json({}),
    extra: { waitForCredentialReady: async () => { throw failure; } },
  });
  await assert.rejects(client.request('/v2/me', {}, { signal: new AbortController().signal }), failure);
  assert.equal(calls.length, 0);
});

test('401 사이에 다른 요청이 토큰을 이미 바꿨으면 갱신 없이 새 토큰으로 한 번 더 보낸다', async () => {
  const auth = session();
  const { client, calls } = makeClient({
    auth,
    fetchImpl: n => {
      if (n === 1) {
        auth.state.access = 'access-new';
        return json({ detail: 'unauthorized' }, 401);
      }
      return json({ ok: true });
    },
  });
  assert.deepEqual(await client.request('/v2/me'), { ok: true });
  assert.deepEqual(calls.map(c => [c.path, c.authorization]), [
    ['/v2/me', 'Bearer access-old'],
    ['/v2/me', 'Bearer access-new'],
  ]);
});

test('refresh 토큰이 없으면 서버에 묻지 않고 세션을 지운 뒤 unauthorized', async () => {
  const auth = session({ refresh: null });
  const { client, calls } = makeClient({ auth, fetchImpl: () => json({ detail: 'unauthorized' }, 401) });
  const error = await client.request('/v2/me').catch(e => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 401);
  assert.equal(error.code, 'unauthorized');
  assert.deepEqual(auth.state.cleared, [{ authSessionEpoch: 0, refreshToken: null }]);
  assert.deepEqual(calls.map(c => c.path), ['/v2/me']);
});

test('refresh 토큰이 없는데 삭제가 늦어 다른 저장이 이겼으면 같은 세션이라 한 번 더 보낸다', async () => {
  const auth = session({ refresh: null, clearResult: false });
  const { client, calls } = makeClient({
    auth,
    fetchImpl: n => (n === 1 ? json({ detail: 'unauthorized' }, 401) : json({ ok: true })),
  });
  assert.deepEqual(await client.request('/v2/me'), { ok: true });
  assert.equal(calls.length, 2);
});

test('postIdempotent: 마감이 이미 지났으면 보내지 않고 timeout', async () => {
  const { client, calls } = makeClient({ fetchImpl: () => json({}), clock: fakeClock() });
  const error = await client.postIdempotent('/v2/practices', { a: 1 }, { deadlineMs: 0 }).catch(e => e);
  assert.ok(error instanceof RequestAbortError);
  assert.equal(error.kind, 'timeout');
  assert.equal(calls.length, 0);
});

test('postIdempotent: 429 대기가 마감을 다 쓰면 마지막 429 를 던진다', async () => {
  const clock = fakeClock();
  const waits = [];
  const { client, calls } = makeClient({ fetchImpl: () => json({ detail: 'rate_limited' }, 429), clock });
  const pending = client.postIdempotent('/v2/practices', { a: 1 }, { deadlineMs: 1_000, onWait: info => waits.push(info) });
  const settled = pending.catch(e => e);
  while (waits.length === 0) await new Promise(resolve => setImmediate(resolve));
  clock.runNext();
  const error = await settled;
  assert.equal(error.status, 429);
  assert.equal(error.code, 'rate_limited');
  assert.deepEqual(waits, [{ reason: 'rate_limited', attempt: 1, delayMs: 1_000 }]);
  assert.equal(calls.length, 1);
});

test('postIdempotent: 하루 한도 429(*_limit)는 기다리지 않고 바로 던진다', async () => {
  const clock = fakeClock();
  const waits = [];
  const { client, calls } = makeClient({ fetchImpl: () => json({ detail: 'daily_entry_limit' }, 429), clock });
  const error = await client
    .postIdempotent('/v2/challenges/c1/entries', { a: 1 }, { onWait: info => waits.push(info) })
    .catch(e => e);
  assert.equal(error.status, 429);
  assert.equal(error.code, 'daily_entry_limit');
  assert.deepEqual(waits, []);
  assert.equal(calls.length, 1);
  assert.equal(clock.pending, 0);
});

test('postIdempotent: 재시도 대기 중에 취소하면 대기 타이머를 지우고 cancelled', async () => {
  const clock = fakeClock();
  const controller = new AbortController();
  const { client, calls } = makeClient({ fetchImpl: () => json({ detail: 'rate_limited' }, 429), clock });
  let waited = false;
  const settled = client
    .postIdempotent('/v2/practices', {}, { signal: controller.signal, onWait: () => { waited = true; } })
    .catch(e => e);
  while (!waited) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  const error = await settled;
  assert.ok(error instanceof RequestAbortError);
  assert.equal(error.kind, 'cancelled');
  assert.equal(clock.pending, 0);
  assert.equal(calls.length, 1);
});

const runStream = (client, options = {}) =>
  client.postIdempotentStream('/v2/coach/reply/stream', '/v2/coach/reply', { text: '답' }, { requestId: 'rid-1', ...options });

test('스트림 401: 토큰을 갱신하고 새 토큰으로 스트림을 한 번 더 연다', async () => {
  const auth = session();
  const { client, calls, streamCalls } = makeClient({
    auth,
    fetchImpl: () => json({ access_token: 'access-new', refresh_token: 'refresh-new' }),
    streamFetchImpl: n => (n === 1 ? json({ detail: 'unauthorized' }, 401) : sseBody([['done', { message: '최종' }]])),
  });
  assert.deepEqual(await runStream(client), { message: '최종' });
  assert.deepEqual(streamCalls.map(c => c.authorization), ['Bearer access-old', 'Bearer access-new']);
  assert.deepEqual(calls.map(c => [c.path, c.body]), [['/v2/auth/refresh', '{"refresh_token":"refresh-old"}']]);
});

test('스트림 401: 갱신이 거절되면 unauthorized 를 던지고 일반 호출로 돌리지 않는다', async () => {
  const auth = session();
  const { client, calls } = makeClient({
    auth,
    fetchImpl: () => json({ detail: 'invalid refresh' }, 401),
    streamFetchImpl: () => json({ detail: 'unauthorized' }, 401),
  });
  const error = await runStream(client).catch(e => e);
  assert.equal(error.status, 401);
  assert.equal(error.code, 'unauthorized');
  assert.deepEqual(calls.map(c => c.path), ['/v2/auth/refresh']);
  assert.equal(auth.state.access, null);
});

test('스트림 401: 갱신 중 다른 계정으로 바뀌면 session_changed 를 던진다', async () => {
  const auth = session();
  const { client } = makeClient({
    auth,
    fetchImpl: () => {
      auth.state.epoch = 1;
      return json({ access_token: 'access-b', refresh_token: 'refresh-b' });
    },
    streamFetchImpl: () => json({ detail: 'unauthorized' }, 401),
  });
  const error = await runStream(client).catch(e => e);
  assert.equal(error.status, 401);
  assert.equal(error.code, 'session_changed');
  assert.equal(error.message, '로그인 계정이 변경되어 요청을 중단했어요. 다시 시도해 주세요.');
});

test('스트림 401: 갱신 뒤에도 401 이면 두 번째는 그대로 던진다', async () => {
  const { client, streamCalls } = makeClient({
    fetchImpl: () => json({ access_token: 'access-new', refresh_token: 'refresh-new' }),
    streamFetchImpl: () => json({ detail: 'unauthorized' }, 401),
  });
  const error = await runStream(client).catch(e => e);
  assert.equal(error.status, 401);
  assert.equal(error.code, 'unauthorized');
  assert.equal(streamCalls.length, 2);
});

test('스트림 401: retryOn401 을 끈 호출은 갱신하지 않고 바로 던진다', async () => {
  const { client, calls } = makeClient({
    fetchImpl: () => json({}),
    streamFetchImpl: () => json({ detail: 'unauthorized' }, 401),
  });
  const error = await runStream(client, { retryOn401: false }).catch(e => e);
  assert.equal(error.status, 401);
  assert.equal(calls.length, 0);
});

test('스트림 error 이벤트가 처리 중 409 면 같은 request_id 로 일반 호출에 맡긴다', async () => {
  let resets = 0;
  const { client, calls } = makeClient({
    fetchImpl: () => json({ message: '저장된 결과' }),
    streamFetchImpl: () => sseBody([['error', { status: 409, detail: 'request is still processing' }]]),
  });
  assert.deepEqual(await runStream(client, { onReset: () => { resets += 1; } }), { message: '저장된 결과' });
  assert.equal(resets, 1);
  assert.deepEqual(calls.map(c => c.path), ['/v2/coach/reply']);
});

test('스트림이 delta 뒤에 멈춰 시도 제한 시간이 지나면 timeout 을 던지고 일반 호출로 돌리지 않는다', async () => {
  const clock = fakeClock();
  const deltas = [];
  let opened = false;
  const { client, calls } = makeClient({
    clock,
    fetchImpl: () => json({ message: '일반' }),
    streamFetchImpl: (n, url, init) => {
      opened = true;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: delta\ndata: ${JSON.stringify({ text: '쓰는 중' })}\n\n`));
          init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    },
  });
  const settled = runStream(client, { timeoutMs: 5_000, onDelta: text => deltas.push(text) }).catch(e => e);
  while (!opened || deltas.length === 0) await new Promise(resolve => setImmediate(resolve));
  clock.runNext();
  const error = await settled;
  assert.ok(error instanceof RequestAbortError);
  assert.equal(error.kind, 'timeout');
  assert.deepEqual(deltas, ['쓰는 중']);
  assert.equal(calls.length, 0);
});

test('friendlyError: 연습 노트 계약을 모르는 옛 앱은 업데이트 안내, detail 없는 낯선 상태는 상태 번호 문구', () => {
  assert.equal(friendlyError(409, { detail: 'client_contract_required' }), '앱을 업데이트하면 이 연습 노트를 열 수 있어요.');
  assert.equal(friendlyError(418, { message: 'teapot' }), '요청을 처리하지 못했어요. (오류 418)');
});

test('갱신 응답이 오기 전에 다른 갱신이 refresh 토큰을 이미 돌렸으면 저장하지 않고 새 토큰으로 재시도한다', async () => {
  const auth = session();
  const { client, calls } = makeClient({
    auth,
    fetchImpl: (n, url) => {
      if (String(url).endsWith('/v2/auth/refresh')) {
        auth.state.access = 'access-other';
        auth.state.refresh = 'refresh-other';
        return json({ access_token: 'access-mine', refresh_token: 'refresh-mine' });
      }
      return n === 1 ? json({ detail: 'unauthorized' }, 401) : json({ ok: true });
    },
  });
  assert.deepEqual(await client.request('/v2/me'), { ok: true });
  assert.deepEqual(auth.state.committed, []);
  assert.equal(calls.at(-1).authorization, 'Bearer access-other');
});

test('갱신 저장이 stale 이면: 같은 세션은 재시도하고, 그 사이 세션이 바뀌었으면 session_changed', async () => {
  for (const [epochMovesDuringCommit, expected] of [[false, 'retried'], [true, 'session_changed']]) {
    const auth = session();
    auth.deps.setTokens = async () => {
      if (epochMovesDuringCommit) auth.state.epoch += 1;
      return 'stale';
    };
    const { client } = makeClient({
      auth,
      fetchImpl: (n, url) => {
        if (String(url).endsWith('/v2/auth/refresh')) return json({ access_token: 'a2', refresh_token: 'r2' });
        return n === 1 ? json({ detail: 'unauthorized' }, 401) : json({ ok: true });
      },
    });
    const outcome = await client.request('/v2/me').then(() => 'retried', e => e.code);
    assert.equal(outcome, expected);
  }
});

test('스트림이 426 이면 업데이트 안내를 알리고 같은 오류를 던진다', async () => {
  let updateRequired = 0;
  const { client, calls } = makeClient({
    fetchImpl: () => json({}),
    streamFetchImpl: () => json({ detail: '앱을 업데이트해 주세요.' }, 426),
    extra: { emitUpdateRequired: () => { updateRequired += 1; } },
  });
  const error = await runStream(client).catch(e => e);
  assert.equal(error.status, 426);
  assert.equal(error.code, 'update_required');
  assert.equal(updateRequired, 1);
  assert.equal(calls.length, 0);
});

test('스트림이 끊겼을 때 전체 마감이 이미 지났으면 일반 호출 없이 timeout', async () => {
  let now = 0;
  let resets = 0;
  const clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => {} };
  const { client, calls } = makeClient({
    clock,
    fetchImpl: () => json({ message: '일반' }),
    streamFetchImpl: () => {
      now = 5_000;
      return sseBody([['delta', { text: '일부' }]]);
    },
  });
  const error = await runStream(client, { deadlineMs: 1_000, onReset: () => { resets += 1; } }).catch(e => e);
  assert.ok(error instanceof RequestAbortError);
  assert.equal(error.kind, 'timeout');
  assert.equal(resets, 1);
  assert.equal(calls.length, 0);
});
