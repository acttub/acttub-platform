import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ApiError,
  createApiRequestClient,
} from '../lib/api-request.ts';

test('API client는 403 원 요청을 재실행하지 않고 consent_required를 emit한다', async () => {
  let requests = 0;
  let bodyReads = 0;
  let consentEvents = 0;
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async () => {
      requests += 1;
      return {
        ok: false,
        status: 403,
        text: async () => {
          bodyReads += 1;
          return JSON.stringify({ detail: 'consent_required' });
        },
      };
    },
    waitForCredentialReady: async () => {},
    getAccessToken: () => 'access',
    getRefreshToken: () => 'refresh',
    getAuthSessionEpoch: () => 0,
    setTokens: async () => 'refreshed',
    clearTokens: async () => true,
    emitConsentRequired: () => {
      consentEvents += 1;
    },
    emitAccountDeactivated: () => {},
  });

  await assert.rejects(
    client.request('/v2/protected'),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'consent_required' &&
      error.detail === 'consent_required',
  );
  assert.equal(requests, 1);
  assert.equal(bodyReads, 1);
  assert.equal(consentEvents, 1);
});

test('API client는 consent_blocked도 재실행하지 않고 동의 판정을 다시 읽게 한다', async () => {
  let requests = 0;
  let consentEvents = 0;
  let capability;
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async (_url, init) => {
      requests += 1;
      capability = new Headers(init.headers).get('X-Acttub-Consent-Entry');
      return new Response(JSON.stringify({ detail: 'consent_blocked' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    waitForCredentialReady: async () => {},
    getAccessToken: () => 'access',
    getRefreshToken: () => 'refresh',
    getAuthSessionEpoch: () => 0,
    setTokens: async () => 'refreshed',
    clearTokens: async () => true,
    emitConsentRequired: () => {
      consentEvents += 1;
    },
    emitAccountDeactivated: () => {},
  });

  await assert.rejects(
    client.request('/v2/protected'),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'consent_blocked',
  );
  assert.equal(requests, 1);
  assert.equal(consentEvents, 1);
  assert.equal(capability, '1');
});
