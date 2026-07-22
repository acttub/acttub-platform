import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const readSource = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), 'utf8');

test('token store는 consent-required pub/sub를 제공한다', () => {
  const source = readSource('lib/token-store.ts');

  assert.match(source, /export function onConsentRequired/);
  assert.match(source, /export function emitConsentRequired/);
});

test('API client는 403 body를 한 번 읽고 consent_required를 emit한다', () => {
  const source = readSource('lib/api.ts');

  assert.match(source, /res\.status === 403/);
  assert.match(source, /detail === 'consent_required'/);
  assert.match(source, /emitConsentRequired\(\)/);
  assert.match(source, /pendingConsents\(\)/);
  assert.match(source, /'\/v2\/consents\/pending'/);
  assert.match(source, /public (?:readonly )?code/);
  assert.match(source, /public (?:readonly )?detail/);
});

test('AuthProvider와 consent 화면은 서버 pending 목록으로 상태를 복구한다', () => {
  const auth = readSource('lib/auth.tsx');
  const consent = readSource('app/consent.tsx');

  assert.match(auth, /onConsentRequired/);
  assert.match(auth, /api\.pendingConsents\(\)/);
  assert.match(auth, /setPendingConsents\(documents\)/);
  assert.match(consent, /pendingConsents\.length > 0/);
  assert.match(consent, /refreshPendingConsents\(\)/);
});
