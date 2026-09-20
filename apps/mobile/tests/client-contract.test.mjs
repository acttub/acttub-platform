import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiError,
  classifyUnprocessable,
  conflictProviders,
  createApiRequestClient,
  pendingConsentsOf,
} from '../lib/api-request.ts';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createClient(fetchImpl, overrides = {}) {
  const events = { consent: [], profile: 0, deactivated: 0, update: 0 };
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    clientHeader: 'app/1.0.0',
    fetchImpl,
    waitForCredentialReady: async () => {},
    getAccessToken: () => 'access',
    getRefreshToken: () => 'refresh',
    getAuthSessionEpoch: () => 0,
    setTokens: async () => 'refreshed',
    clearTokens: async () => true,
    emitConsentRequired: (documents) => {
      events.consent.push(documents);
    },
    emitProfileRequired: () => {
      events.profile += 1;
    },
    emitAccountDeactivated: () => {
      events.deactivated += 1;
    },
    emitUpdateRequired: () => {
      events.update += 1;
    },
    ...overrides,
  });
  return { client, events };
}

test('공통 규칙: 로그인한 요청과 로그인 없는 요청 모두 X-Acttub-Client를 보내고 X-Acttub-Consent-Entry는 보내지 않는다', async () => {
  const seen = [];
  const { client } = createClient(async (_url, init) => {
    seen.push(new Headers(init.headers));
    return jsonResponse({ ok: true });
  });

  await client.request('/v2/practice-sessions');
  await client.request('/v2/auth/providers', {}, { auth: false });

  assert.equal(seen.length, 2);
  for (const headers of seen) {
    assert.equal(headers.get('X-Acttub-Client'), 'app/1.0.0');
    assert.equal(headers.get('X-Acttub-Consent-Entry'), null);
  }
});

test('공통 규칙: 토큰 갱신 요청에도 X-Acttub-Client가 실린다', async () => {
  const refreshHeaders = [];
  let protectedCalls = 0;
  const { client } = createClient(async (url, init) => {
    if (String(url).endsWith('/v2/auth/refresh')) {
      refreshHeaders.push(new Headers(init.headers));
      return jsonResponse({ access_token: 'access-new', refresh_token: 'refresh-new' });
    }
    protectedCalls += 1;
    return protectedCalls === 1
      ? jsonResponse({ detail: 'invalid or missing access token' }, 401)
      : jsonResponse({ ok: true });
  });

  await client.request('/v2/protected');

  assert.equal(refreshHeaders.length, 1);
  assert.equal(refreshHeaders[0].get('X-Acttub-Client'), 'app/1.0.0');
});

test('공통 규칙: 426을 받으면 업데이트 안내를 알리고 안내 문장을 그대로 담은 오류를 던진다', async () => {
  const sentence = '새 버전이 나왔어요. 스토어에서 업데이트해 주세요.';
  const { client, events } = createClient(async () => jsonResponse({ detail: sentence }, 426));

  await assert.rejects(
    client.request('/v2/practice-sessions'),
    (error) =>
      error instanceof ApiError &&
      error.status === 426 &&
      error.code === 'update_required' &&
      error.message === sentence,
  );
  assert.equal(events.update, 1);
});

test('공통 규칙: 로그인 없는 요청의 426도 업데이트 안내를 알린다', async () => {
  const { client, events } = createClient(async () =>
    jsonResponse({ detail: '새 버전이 나왔어요.' }, 426),
  );

  await assert.rejects(client.request('/v2/auth/login', { method: 'POST' }, { auth: false }));
  assert.equal(events.update, 1);
});

test('account.login: 403 consent_required는 미결정 문서 목록을 함께 알린다', async () => {
  const pending = [{ id: 'doc-retention', type: 'retention', required: false }];
  const { client, events } = createClient(async () =>
    jsonResponse({ detail: 'consent_required', pending_consents: pending }, 403),
  );

  await assert.rejects(
    client.request('/v2/practice-sessions'),
    (error) =>
      error instanceof ApiError &&
      error.code === 'consent_required' &&
      pendingConsentsOf(error).length === 1,
  );
  assert.deepEqual(events.consent, [pending]);
  assert.equal(events.profile, 0);
  assert.equal(events.deactivated, 0);
});

test('account.profile: 403 profile_required는 프로필 게이트를 알리고 동의 게이트는 건드리지 않는다', async () => {
  const { client, events } = createClient(async () =>
    jsonResponse({ detail: 'profile_required' }, 403),
  );

  await assert.rejects(
    client.request('/v2/practice-sessions'),
    (error) => error instanceof ApiError && error.code === 'profile_required',
  );
  assert.equal(events.profile, 1);
  assert.deepEqual(events.consent, []);
  assert.equal(events.deactivated, 0);
});

test('account.withdraw: 403 account_deactivated는 탈퇴만 알린다', async () => {
  const { client, events } = createClient(async () =>
    jsonResponse({ detail: 'account_deactivated' }, 403),
  );

  await assert.rejects(client.request('/v2/practice-sessions'));
  assert.equal(events.deactivated, 1);
  assert.equal(events.profile, 0);
  assert.deepEqual(events.consent, []);
});

test('account.consent: 없어진 사유 consent_blocked는 동의 게이트로 다루지 않는다', async () => {
  const { client, events } = createClient(async () =>
    jsonResponse({ detail: 'consent_blocked' }, 403),
  );

  await assert.rejects(client.request('/v2/practice-sessions'));
  assert.deepEqual(events.consent, []);
});

test('account.login: 이메일 겹침 409는 기존 계정의 제공자 이름을 함께 준다', async () => {
  const { client } = createClient(async () =>
    jsonResponse(
      { detail: 'account_exists_with_different_provider', providers: ['google'] },
      409,
    ),
  );

  await assert.rejects(
    client.request('/v2/auth/login', { method: 'POST' }, { auth: false }),
    (error) =>
      error instanceof ApiError &&
      error.code === 'account_exists_with_different_provider' &&
      conflictProviders(error).join() === 'google',
  );
});

test('공통 규칙: 형제 필드가 없거나 모양이 다르면 빈 목록이다', () => {
  assert.deepEqual(pendingConsentsOf(new ApiError(403, 'x', 'consent_required')), []);
  assert.deepEqual(
    conflictProviders(
      new ApiError(409, 'x', 'account_exists_with_different_provider', 'x', {
        providers: 'google',
      }),
    ),
    [],
  );
  assert.deepEqual(pendingConsentsOf(new Error('not api')), []);
});

test('공통 규칙: 422의 detail이 문자열이면 사유 코드, 배열이면 앱 버그다', async () => {
  const { client: reasonClient } = createClient(async () =>
    jsonResponse({ detail: 'under_14' }, 422),
  );
  const { client: shapeClient } = createClient(async () =>
    jsonResponse({ detail: [{ type: 'missing', loc: ['body', 'name'], msg: 'required' }] }, 422),
  );

  const reason = await reasonClient.request('/v2/me/profile', { method: 'PUT' }).catch((e) => e);
  const shape = await shapeClient.request('/v2/me/profile', { method: 'PUT' }).catch((e) => e);

  assert.deepEqual(classifyUnprocessable(reason), { kind: 'reason', code: 'under_14' });
  assert.deepEqual(classifyUnprocessable(shape), { kind: 'client_bug' });
  assert.equal(classifyUnprocessable(new ApiError(409, 'x', 'conflict')), null);
  assert.equal(classifyUnprocessable(new Error('not api')), null);
});
