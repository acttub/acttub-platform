import assert from 'node:assert/strict';
import test from 'node:test';
import { api, id } from './helpers/practice-api.mjs';
import { newRequestId } from '../lib/request-id.ts';

// Node 에는 crypto.randomUUID 가 있어 대체 생성기를 아무 테스트도 거치지 않는다. 기기(Hermes)에는 폴리필이 없어
// 대체 생성기가 실제로 쓰일 수 있으니, crypto 를 잠시 없앤 채로 그 출력이 UUID v4 꼴인지 본다.
// 버전 자리가 우연히 4 일 확률이 1/16 이라 한 번으로는 못 거른다 — 여러 번 부른다.
const RUNS = 20;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function withoutCrypto(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
}

function captureFetch(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ requestId: new Headers(init.headers).get('X-Request-Id'), body: init.body ?? null });
    return new Response(null, { status: 204 });
  });
  return calls;
}

test('crypto.randomUUID 가 없으면 newRequestId 는 UUID v4 꼴을 만든다', t => {
  withoutCrypto(t);
  assert.equal(globalThis.crypto, undefined);
  for (let i = 0; i < 200; i += 1) assert.match(newRequestId(), UUID_V4);
});

test('crypto.randomUUID 가 없어도 api.cancelPractice 의 X-Request-Id 는 UUID v4 꼴이다', async t => {
  withoutCrypto(t);
  const calls = captureFetch(t);
  for (let i = 0; i < RUNS; i += 1) await api.cancelPractice(id(1)).catch(() => {});
  assert.equal(calls.length, RUNS);
  for (const { requestId } of calls) assert.match(requestId, UUID_V4);
});

test('crypto.randomUUID 가 없어도 api.retryPracticeAnalysis 는 같은 UUID v4 를 헤더와 본문에 싣는다', async t => {
  withoutCrypto(t);
  const calls = captureFetch(t);
  for (let i = 0; i < RUNS; i += 1) await api.retryPracticeAnalysis(id(1)).catch(() => {});
  assert.equal(calls.length, RUNS);
  for (const { requestId, body } of calls) {
    assert.match(requestId, UUID_V4);
    const bodyId = JSON.parse(body).request_id;
    assert.match(bodyId, UUID_V4);
    assert.equal(bodyId, requestId);
  }
});
