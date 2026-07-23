import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiError,
  RequestAbortError,
  createApiRequestClient,
} from '../lib/api-request.ts';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createTokenState() {
  let access = 'access-old';
  let refresh = 'refresh-old';
  let clearCalls = 0;
  let setCalls = 0;
  return {
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    setTokens: async (nextAccess, nextRefresh) => {
      setCalls += 1;
      access = nextAccess;
      refresh = nextRefresh;
      return 'refreshed';
    },
    clearTokens: async () => {
      clearCalls += 1;
      access = null;
      refresh = null;
      return true;
    },
    snapshot: () => ({ access, refresh, clearCalls, setCalls }),
  };
}

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    get pendingCount() {
      return timers.size;
    },
    runNext() {
      const next = [...timers.entries()].sort(
        ([idA, a], [idB, b]) => a.at - b.at || idA - idB,
      )[0];
      if (!next) return false;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      return true;
    },
  };
}

async function settleWithClock(promise, clock) {
  let settled = false;
  let value;
  let error;
  void promise.then(
    (result) => {
      settled = true;
      value = result;
    },
    (reason) => {
      settled = true;
      error = reason;
    },
  );

  for (let index = 0; index < 100 && !settled; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!settled && clock.pendingCount > 0) clock.runNext();
  }
  if (!settled) throw new Error('fake clock로 promise가 settle되지 않았습니다.');
  if (error !== undefined) throw error;
  return value;
}

function createClient(fetchImpl, tokenState = createTokenState(), extra = {}) {
  return {
    client: createApiRequestClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      waitForCredentialReady: async () => {},
      getAccessToken: tokenState.getAccessToken,
      getRefreshToken: tokenState.getRefreshToken,
      getAuthSessionEpoch: () => 0,
      setTokens: tokenState.setTokens,
      clearTokens: tokenState.clearTokens,
      emitConsentRequired: () => {},
      ...extra,
    }),
    tokenState,
  };
}

for (const refreshStatus of [401, 422]) {
  test(`M4: refresh ${refreshStatus}만 세션을 파기한다`, async () => {
    const { client, tokenState } = createClient(async (url) => {
      if (String(url).endsWith('/v2/auth/refresh')) {
        return jsonResponse({ detail: 'invalid refresh' }, refreshStatus);
      }
      return jsonResponse({ detail: 'expired access' }, 401);
    });

    await assert.rejects(
      client.request('/v2/protected'),
      (error) => error instanceof ApiError && error.status === 401,
    );
    assert.equal(tokenState.snapshot().clearCalls, 1);
    assert.equal(tokenState.snapshot().access, null);
  });
}

test('F2: invalid refresh로 현재 세션을 지운 caller는 session_changed가 아니라 unauthorized다', async () => {
  let authSessionEpoch = 1;
  const tokenState = createTokenState();
  const { client } = createClient(async (url) => {
    if (String(url).endsWith('/v2/auth/refresh')) {
      return jsonResponse({ detail: 'invalid refresh' }, 401);
    }
    return jsonResponse({ detail: 'expired access' }, 401);
  }, tokenState, {
    getAuthSessionEpoch: () => authSessionEpoch,
    clearTokens: async () => {
      authSessionEpoch += 1;
      await tokenState.clearTokens();
      return true;
    },
  });

  await assert.rejects(
    client.request('/v2/protected'),
    (error) => error instanceof ApiError && error.code === 'unauthorized',
  );
});

for (const scenario of [
  {
    name: '429',
    refresh: async () => jsonResponse({ detail: 'rate limit exceeded' }, 429),
    expectedStatus: 429,
  },
  {
    name: '5xx',
    refresh: async () => new Response('upstream down', { status: 503 }),
    expectedStatus: 503,
  },
  {
    name: 'network',
    refresh: async () => {
      throw new TypeError('offline');
    },
    expectedStatus: 0,
  },
]) {
  test(`M4: refresh ${scenario.name}는 세션을 유지하고 오류를 전파한다`, async () => {
    const { client, tokenState } = createClient(async (url) => {
      if (String(url).endsWith('/v2/auth/refresh')) return scenario.refresh();
      return jsonResponse({ detail: 'expired access' }, 401);
    });

    await assert.rejects(
      client.request('/v2/protected'),
      (error) => error instanceof ApiError && error.status === scenario.expectedStatus,
    );
    assert.deepEqual(tokenState.snapshot(), {
      access: 'access-old',
      refresh: 'refresh-old',
      clearCalls: 0,
      setCalls: 0,
    });
  });
}

test('S3: 한 caller 취소는 shared refresh를 죽이지 않고 취소 caller의 추가 fetch를 막는다', async () => {
  let resolveRefresh;
  const refreshResponse = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const pathCalls = new Map();
  let refreshCalls = 0;
  const { client } = createClient(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v2/auth/refresh') {
      refreshCalls += 1;
      return refreshResponse;
    }
    const count = (pathCalls.get(path) ?? 0) + 1;
    pathCalls.set(path, count);
    return count === 1
      ? jsonResponse({ detail: 'expired access' }, 401)
      : jsonResponse({ ok: path });
  });

  const cancelledController = new AbortController();
  const cancelled = client.request('/v2/cancelled', {}, {
    signal: cancelledController.signal,
  });
  const survivor = client.request('/v2/survivor');

  for (let index = 0; index < 10 && refreshCalls === 0; index += 1) {
    await Promise.resolve();
  }
  cancelledController.abort();
  await assert.rejects(
    cancelled,
    (error) => error instanceof RequestAbortError && error.kind === 'cancelled',
  );

  resolveRefresh(jsonResponse({
    access_token: 'access-new',
    refresh_token: 'refresh-new',
  }));
  assert.deepEqual(await survivor, { ok: '/v2/survivor' });
  assert.equal(refreshCalls, 1);
  assert.equal(pathCalls.get('/v2/cancelled'), 1);
  assert.equal(pathCalls.get('/v2/survivor'), 2);
});

test('F2: shared refresh 중 auth session이 바뀌면 기존 mutation을 새 계정으로 재전송하지 않는다', async () => {
  let authSessionEpoch = 1;
  let resolveRefresh;
  const refreshResponse = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const tokenState = createTokenState();
  const protectedAuthorizations = [];
  let refreshCalls = 0;
  const { client } = createClient(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v2/auth/refresh') {
      refreshCalls += 1;
      return refreshResponse;
    }
    protectedAuthorizations.push(new Headers(init.headers).get('Authorization'));
    return protectedAuthorizations.length === 1
      ? jsonResponse({ detail: 'expired access' }, 401)
      : jsonResponse({ ok: true });
  }, tokenState, {
    getAuthSessionEpoch: () => authSessionEpoch,
  });

  const originalMutation = client.request(
    '/v2/consents',
    {
      method: 'POST',
      body: JSON.stringify({ document_id: 'terms-1', action: 'granted' }),
    },
  );
  for (let index = 0; index < 10 && refreshCalls === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(refreshCalls, 1);

  authSessionEpoch += 1;
  await tokenState.setTokens('access-b', 'refresh-b');
  resolveRefresh(jsonResponse({
    access_token: 'access-a-refreshed',
    refresh_token: 'refresh-a-refreshed',
  }));

  await assert.rejects(
    originalMutation,
    (error) => error instanceof ApiError && error.code === 'session_changed',
  );
  assert.deepEqual(protectedAuthorizations, ['Bearer access-old']);
  assert.equal(tokenState.snapshot().access, 'access-b');
  assert.equal(tokenState.snapshot().refresh, 'refresh-b');
});

test('R1: refresh가 principal을 교정하면 기존 mutation을 새 principal token으로 재전송하지 않는다', async () => {
  let accessToken = 'access-a';
  let refreshToken = 'refresh-a';
  const protectedAuthorizations = [];
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v2/auth/refresh') {
        return jsonResponse({
          access_token: 'access-b',
          refresh_token: 'refresh-b',
        });
      }
      protectedAuthorizations.push(new Headers(init.headers).get('Authorization'));
      return protectedAuthorizations.length === 1
        ? jsonResponse({ detail: 'expired access' }, 401)
        : jsonResponse({ ok: true });
    },
    waitForCredentialReady: async () => {},
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    getAuthSessionEpoch: () => 7,
    setTokens: async (nextAccessToken, nextRefreshToken) => {
      accessToken = nextAccessToken;
      refreshToken = nextRefreshToken;
      return 'principal_changed';
    },
    clearTokens: async () => true,
    emitConsentRequired: () => {},
  });

  await assert.rejects(
    client.request(
      '/v2/consents',
      {
        method: 'POST',
        body: JSON.stringify({ document_id: 'terms-a', action: 'granted' }),
      },
    ),
    (error) => error instanceof ApiError && error.code === 'session_changed',
  );
  assert.deepEqual(protectedAuthorizations, ['Bearer access-a']);
});

test('R2: 같은 epoch의 선행 token rotation이 invalid refresh clear를 이기면 새 token으로 재시도한다', async () => {
  let authSessionEpoch = 3;
  const tokenState = createTokenState();
  const protectedAuthorizations = [];
  const { client } = createClient(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v2/auth/refresh') {
      await tokenState.setTokens('access-rotated', 'refresh-rotated');
      return jsonResponse({ detail: 'already rotated' }, 401);
    }
    protectedAuthorizations.push(new Headers(init.headers).get('Authorization'));
    return protectedAuthorizations.length === 1
      ? jsonResponse({ detail: 'expired access' }, 401)
      : jsonResponse({ ok: true });
  }, tokenState, {
    getAuthSessionEpoch: () => authSessionEpoch,
    clearTokens: async (expectation) => {
      if (
        authSessionEpoch !== expectation.authSessionEpoch ||
        tokenState.getRefreshToken() !== expectation.refreshToken
      ) {
        return false;
      }
      authSessionEpoch += 1;
      await tokenState.clearTokens();
      return true;
    },
  });

  assert.deepEqual(await client.request('/v2/protected'), { ok: true });
  assert.deepEqual(protectedAuthorizations, [
    'Bearer access-old',
    'Bearer access-rotated',
  ]);
  assert.equal(tokenState.snapshot().clearCalls, 0);
});

test('F2: idempotent backoff 중 auth session이 바뀌면 다음 attempt를 새 계정으로 보내지 않는다', async () => {
  const clock = createFakeClock();
  let authSessionEpoch = 1;
  const tokenState = createTokenState();
  const authorizations = [];
  let backoffReady = false;
  const { client } = createClient(async (_url, init) => {
    authorizations.push(new Headers(init.headers).get('Authorization'));
    return authorizations.length === 1
      ? jsonResponse({ detail: 'request is still processing' }, 409)
      : jsonResponse({ ok: true });
  }, tokenState, {
    clock,
    getAuthSessionEpoch: () => authSessionEpoch,
  });
  const originalMutation = client.postIdempotent(
    '/v2/practice-sessions',
    { upload_intent_id: 'intent-a' },
    {
      deadlineMs: 1_000_000,
      onWait: () => {
        backoffReady = true;
      },
    },
  );
  for (let index = 0; index < 10 && !backoffReady; index += 1) {
    await Promise.resolve();
  }
  assert.deepEqual(authorizations, ['Bearer access-old']);
  assert.equal(backoffReady, true);
  assert.equal(clock.pendingCount, 1);

  authSessionEpoch += 1;
  await tokenState.setTokens('access-b', 'refresh-b');
  clock.runNext();

  await assert.rejects(
    originalMutation,
    (error) => error instanceof ApiError && error.code === 'session_changed',
  );
  assert.deepEqual(authorizations, ['Bearer access-old']);
});

test('S3: per-attempt timeout과 caller cancelled 원인을 구분한다', async () => {
  const clock = createFakeClock();
  const hangingFetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), {
        once: true,
      });
    });
  const { client } = createClient(hangingFetch, createTokenState(), { clock });

  const timedOut = client.request('/v2/slow', {}, { timeoutMs: 50 });
  await assert.rejects(
    settleWithClock(timedOut, clock),
    (error) => error instanceof RequestAbortError && error.kind === 'timeout',
  );

  const controller = new AbortController();
  const cancelled = client.request('/v2/cancel', {}, {
    signal: controller.signal,
    timeoutMs: 10_000,
  });
  controller.abort();
  await assert.rejects(
    cancelled,
    (error) => error instanceof RequestAbortError && error.kind === 'cancelled',
  );
});

for (const retryScenario of ['processing', 'rate_limited', 'network', 'refresh']) {
  test(`M6: ${retryScenario} 재시도는 모든 attempt의 request id와 body 바이트가 같다`, async () => {
    const clock = createFakeClock();
    const endpointRequests = [];
    let refreshCalls = 0;
    const { client } = createClient(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v2/auth/refresh') {
        refreshCalls += 1;
        return jsonResponse({
          access_token: 'access-new',
          refresh_token: 'refresh-new',
        });
      }
      endpointRequests.push({
        requestId: new Headers(init.headers).get('X-Request-Id'),
        body: init.body,
      });
      if (endpointRequests.length > 1) return jsonResponse({ ok: true });
      if (retryScenario === 'processing') {
        return jsonResponse({ detail: 'request is still processing' }, 409);
      }
      if (retryScenario === 'rate_limited') {
        return jsonResponse({ detail: 'rate limit exceeded' }, 429);
      }
      if (retryScenario === 'network') throw new TypeError('socket closed');
      return jsonResponse({ detail: 'expired access' }, 401);
    }, createTokenState(), { clock, random: () => 0 });

    const body = { scene: 'same', count: 1 };
    const result = await settleWithClock(
      client.postIdempotent('/v2/example', body, {
        requestId: 'fixed-request-id',
        deadlineMs: 1_000_000,
      }),
      clock,
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(endpointRequests.length, 2);
    assert.deepEqual(
      endpointRequests.map(({ requestId }) => requestId),
      ['fixed-request-id', 'fixed-request-id'],
    );
    assert.equal(endpointRequests[0].body, JSON.stringify(body));
    assert.equal(endpointRequests[1].body, endpointRequests[0].body);
    assert.equal(refreshCalls, retryScenario === 'refresh' ? 1 : 0);
  });
}

test('M6: backoff 중 취소하면 추가 fetch를 하지 않는다', async () => {
  const clock = createFakeClock();
  let fetchCalls = 0;
  const { client } = createClient(async () => {
    fetchCalls += 1;
    return jsonResponse({ detail: 'request is still processing' }, 409);
  }, createTokenState(), { clock });
  const controller = new AbortController();
  const pending = client.postIdempotent('/v2/example', { scene: 'cancel' }, {
    requestId: 'cancel-request-id',
    signal: controller.signal,
    deadlineMs: 1_000_000,
  });

  for (let index = 0; index < 10 && clock.pendingCount === 0; index += 1) {
    await Promise.resolve();
  }
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof RequestAbortError && error.kind === 'cancelled',
  );
  assert.equal(fetchCalls, 1);
});

test('W5: plain text 500과 Pydantic 422를 한국어 문구로 숨긴다', async () => {
  const responses = [
    new Response('Internal Server Error', { status: 500 }),
    jsonResponse({
      detail: [{ type: 'int_from_float', msg: 'Input should be a valid integer' }],
    }, 422),
  ];
  const { client } = createClient(async () => responses.shift());

  await assert.rejects(
    client.request('/v2/report'),
    (error) =>
      error instanceof ApiError &&
      error.status === 500 &&
      error.message === '서버 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
  );
  await assert.rejects(
    client.request('/v2/upload'),
    (error) =>
      error instanceof ApiError &&
      error.status === 422 &&
      error.message === '입력값을 확인해주세요. 문제가 계속되면 영상을 다시 선택해주세요.',
  );
});
