import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ApiError,
  createApiRequestClient,
} from '../lib/api-request.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const readSource = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), 'utf8');

test('token store는 consent-required pub/sub를 제공한다', () => {
  const source = readSource('lib/token-store.ts');

  assert.match(source, /export function onConsentRequired/);
  assert.match(source, /export function emitConsentRequired/);
});

test('API client는 403 body를 한 번 읽고 consent_required를 emit한다', async () => {
  let bodyReads = 0;
  let consentEvents = 0;
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () => {
        bodyReads += 1;
        return JSON.stringify({ detail: 'consent_required' });
      },
    }),
    getAccessToken: () => 'access',
    getRefreshToken: () => 'refresh',
    setTokens: async () => {},
    clearTokens: async () => {},
    emitConsentRequired: () => {
      consentEvents += 1;
    },
  });

  await assert.rejects(
    client.request('/v2/protected'),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'consent_required' &&
      error.detail === 'consent_required',
  );
  assert.equal(bodyReads, 1);
  assert.equal(consentEvents, 1);
});

test('AuthProvider와 consent 화면은 서버 pending 목록으로 상태를 복구한다', () => {
  const auth = readSource('lib/auth.tsx');
  const consent = readSource('app/consent.tsx');
  const layout = readSource('app/_layout.tsx');

  assert.match(auth, /onConsentRequired/);
  assert.match(auth, /api\.pendingConsents\(\)/);
  assert.match(auth, /setPendingConsents\(documents\)/);
  assert.match(auth, /consentRequired: boolean/);
  assert.match(auth, /onConsentRequired\(\(\) => \{\s*setConsentRequired\(true\);/);
  assert.match(auth, /setPendingConsents\(\[\]\);\s*setConsentRequired\(false\);/);
  assert.match(layout, /consentRequired \|\| pendingConsents\.length > 0/);
  assert.match(consent, /pendingConsents\.length > 0/);
  assert.match(consent, /refreshPendingConsents\(\)/);
  assert.match(
    consent,
    /if \(status !== 'signedIn' \|\| pendingConsents\.length > 0\) return;/,
  );
  assert.match(consent, /getUserName\(\)/);
  assert.match(consent, /onPress=\{\(\) => void loadPendingConsents\(\)\}/);
});
