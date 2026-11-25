import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiRequestClient } from '../lib/api-request.ts';
import { createConsentEntrySession } from '../lib/consent-entry.ts';
import { createConsentGate, isOutsideConsentGate } from '../lib/consent-gate.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGatedClient(gate, { epoch = () => 0 } = {}) {
  const sent = [];
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`);
      return jsonResponse({ ok: true });
    },
    waitForCredentialReady: async () => {},
    waitForConsentGate: gate.waitFor,
    getAccessToken: () => 'access',
    getRefreshToken: () => 'refresh',
    getAuthSessionEpoch: epoch,
    setTokens: async () => 'refreshed',
    clearTokens: async () => true,
    emitConsentRequired: () => {},
    emitProfileRequired: () => {},
    emitAccountDeactivated: () => {},
    emitUpdateRequired: () => {},
  });
  return { client, sent };
}

/** 홈 첫 데이터·탭 미리 받기·홈 뒤로 미룬 호출이 부르는 게이트 안 경로(운영 로그 11/25 의 403 목록). */
const GATED_LAUNCH_PATHS = [
  '/v2/practices/days',
  '/v2/reading/scripts',
  '/v2/practices',
  '/v2/me/challenge-entries',
  '/v2/app/posters',
  '/v2/ads',
  '/v2/challenges?tab=popular',
  '/v2/billing/me',
  '/v2/me/notifications/unread-count',
  '/v2/reading/voice/status',
];

test('서버 동의 게이트 밖 경로만 게이트 밖으로 본다', () => {
  for (const [method, path] of [
    ['GET', '/v2/me'],
    ['GET', '/v2/consents/entry'],
    ['POST', '/v2/consents'],
    ['POST', '/v2/auth/refresh'],
    ['GET', '/v2/app/config'],
    ['GET', '/v2/auditions'],
    ['GET', '/v2/admissions'],
    ['DELETE', '/v2/push-tokens'],
    ['GET', '/healthz'],
  ]) {
    assert.equal(isOutsideConsentGate(method, path), true, `${method} ${path}`);
  }
  for (const [method, path] of [
    ['PUT', '/v2/me/profile'],
    ['GET', '/v2/me/notifications/unread-count'],
    ['POST', '/v2/auditions'],
    ['GET', '/v2/authors'],
    ...GATED_LAUNCH_PATHS.map((path) => ['GET', path]),
  ]) {
    assert.equal(isOutsideConsentGate(method, path), false, `${method} ${path}`);
  }
});

test('판정 전·allowed 에서는 붙잡지 않는다 — 이미 동의한 회원의 시작은 그대로다', async () => {
  const gate = createConsentGate();
  const { client, sent } = createGatedClient(gate);
  await Promise.all(GATED_LAUNCH_PATHS.map((path) => client.request(path)));
  assert.equal(sent.length, GATED_LAUNCH_PATHS.length);

  gate.close();
  gate.open();
  await client.request('/v2/practices');
  assert.equal(sent.length, GATED_LAUNCH_PATHS.length + 1);
});

test('동의 필요로 판정되면 미리 받기·미룬 호출을 보내지 않고, 동의 직후 바로 보낸다', async () => {
  const gate = createConsentGate();
  const { client, sent } = createGatedClient(gate);
  gate.close();

  const held = GATED_LAUNCH_PATHS.map((path) => client.request(path));
  const idempotent = client.postIdempotent('/v2/practices/feedback', { score: 1 });
  const me = await client.request('/v2/me');
  const consent = await client.postIdempotent('/v2/consents', { decisions: [] });
  await flush();

  assert.deepEqual(me, { ok: true });
  assert.deepEqual(consent, { ok: true });
  assert.deepEqual(sent, ['GET /v2/me', 'POST /v2/consents']);

  gate.open();
  await Promise.all([...held, idempotent]);
  assert.equal(sent.length, 2 + GATED_LAUNCH_PATHS.length + 1);
  assert.ok(sent.includes('GET /v2/billing/me'));
  assert.ok(sent.includes('POST /v2/practices/feedback'));
});

test('붙잡힌 사이 로그아웃하면 풀려나도 보내지 않는다', async () => {
  const gate = createConsentGate();
  let epoch = 0;
  const { client, sent } = createGatedClient(gate, { epoch: () => epoch });
  gate.close();
  const held = client.request('/v2/practices');
  await flush();
  epoch += 1;
  gate.open();
  await assert.rejects(held, (error) => error.code === 'session_changed');
  assert.deepEqual(sent, []);
});

test('붙잡힌 요청은 취소 신호로 끝낼 수 있다', async () => {
  const gate = createConsentGate();
  const { client, sent } = createGatedClient(gate);
  gate.close();
  const controller = new AbortController();
  const held = client.request('/v2/practices', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(held, (error) => error.name === 'RequestAbortError' || error.kind === 'cancelled');
  gate.open();
  await flush();
  assert.deepEqual(sent, []);
});

const entryOf = (entry_status) => ({ entry_status, documents: [], undecided_documents: [] });

test('한꺼번에 막힌 403 들은 동의 판정을 다시 읽게 하지 않는다 — 한 실행에 한 번만 읽는다', async () => {
  let reads = 0;
  let resolveRead;
  const session = createConsentEntrySession({
    readEntry: () => {
      reads += 1;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
  });
  // auth.tsx 의 403 consent_required 처리와 같은 규칙: 다시 읽어야 할 때만 refresh 한다.
  const onRejected = () => {
    if (session.shouldRecheckOnRejection()) void session.refresh();
  };

  const first = session.readOnce();
  for (let index = 0; index < 20; index += 1) onRejected(); // 판정이 오기 전에 돌아온 403
  resolveRead(entryOf('decision_required'));
  await first;
  for (let index = 0; index < 20; index += 1) onRejected(); // 판정 뒤에 돌아온 403
  await session.readOnce();
  assert.equal(reads, 1);
});

test('allowed 로 알던 중 403 이면 새 판이 나온 것이라 한 번 다시 읽는다', async () => {
  let reads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      reads += 1;
      return entryOf(reads === 1 ? 'allowed' : 'decision_required');
    },
  });
  await session.readOnce();
  assert.equal(session.shouldRecheckOnRejection(), true);
  const recheck = session.refresh();
  assert.equal(session.shouldRecheckOnRejection(), false);
  await recheck;
  assert.equal(session.shouldRecheckOnRejection(), false);
  assert.equal(reads, 2);
});

test('첫 읽기가 실패해 판정이 없으면 403 에 다시 읽는다', async () => {
  const session = createConsentEntrySession({
    readEntry: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(session.readOnce());
  assert.equal(session.shouldRecheckOnRejection(), true);
  session.clear();
  assert.equal(session.shouldRecheckOnRejection(), true);
});
