import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { ApiError, createApiRequestClient, friendlyError } from '../lib/api-request.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const readSource = (relativePath) => readFileSync(path.join(appRoot, relativePath), 'utf8');

/**
 * 회원탈퇴 (SOMA-319).
 *
 * 되돌릴 수 없는 기능이라 순서와 문구를 테스트로 못박는다. 특히 "서버가 성공한 뒤에만
 * 로컬을 지운다" 는 순서가 뒤집히면, 계정은 살아 있는데 사용자는 탈퇴한 줄 알고 떠난다.
 */

test('token store는 account-deactivated pub/sub을 제공한다', () => {
  const source = readSource('lib/token-store.ts');

  assert.match(source, /export function onAccountDeactivated/);
  assert.match(source, /export function emitAccountDeactivated/);
});

test('API client는 403 account_deactivated에 탈퇴 이벤트만 쏜다', async () => {
  let consentEvents = 0;
  let deactivatedEvents = 0;
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ detail: 'account_deactivated' }),
    }),
    waitForCredentialReady: async () => {},
    getAccessToken: () => 'access',
    getRefreshToken: () => 'refresh',
    getAuthSessionEpoch: () => 0,
    setTokens: async () => 'refreshed',
    clearTokens: async () => true,
    emitConsentRequired: () => {
      consentEvents += 1;
    },
    emitAccountDeactivated: () => {
      deactivatedEvents += 1;
    },
  });

  await assert.rejects(
    client.request('/v2/protected'),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'account_deactivated',
  );
  assert.equal(deactivatedEvents, 1);
  // 동의 게이트를 건드리면 약관 화면이 뜬다 — 탈퇴한 계정에는 보여줄 약관이 없다.
  assert.equal(consentEvents, 0);
});

test('403 문구는 탈퇴와 권한 부족을 구분한다', () => {
  assert.match(
    friendlyError(403, { detail: 'account_deactivated' }),
    /탈퇴한 계정/,
  );
  assert.match(friendlyError(403, { detail: 'forbidden' }), /권한이 없어요/);
});

test('api.deleteMe는 DELETE /v2/me를 부른다', () => {
  const source = readSource('lib/api.ts');

  assert.match(source, /deleteMe\(\): Promise<void>/);
  assert.match(source, /request<void>\('\/v2\/me',\s*\{ method: 'DELETE' \}/);
  assert.match(source, /emitAccountDeactivated,/);
});

test('deleteAccount는 서버가 성공한 뒤에만 로컬을 지운다', () => {
  const source = readSource('lib/auth.tsx');
  const body = source.slice(source.indexOf('const deleteAccount'));
  const serverCall = body.indexOf('api.deleteMe()');
  const localWipe = body.indexOf('clearLocalAccountData()');
  const tokenWipe = body.indexOf('clearLocalSession: clearTokens');

  assert.ok(serverCall > -1, 'api.deleteMe를 부르지 않는다');
  assert.ok(localWipe > serverCall, '서버 성공 전에 로컬을 지운다');
  assert.ok(tokenWipe > serverCall, '서버 성공 전에 토큰을 지운다');
  // 탈퇴가 refresh 를 이미 전부 끊었으므로 로그아웃 API 를 또 부르면 실패만 남는다.
  assert.match(body, /serverLogout: async \(\) => undefined/);
});

test('탈퇴 이벤트를 받으면 세션을 끊는다', () => {
  const source = readSource('lib/auth.tsx');

  assert.match(source, /onAccountDeactivated\(\(\) => \{/);
  assert.match(source, /deleteAccount: \(\) => Promise<void>;/);
});

test('로컬 파기는 acttub 접두사 저장소와 이름·연습 상태를 지운다', () => {
  const source = readSource('lib/local-account-data.ts');

  assert.match(source, /startsWith\(KEY_PREFIX\)/);
  assert.match(source, /multiRemove/);
  assert.match(source, /deleteUserName\(\)/);
  assert.match(source, /resetPracticeState\(\)/);
  assert.match(readSource('lib/profile.ts'), /export async function deleteUserName/);
  assert.match(readSource('lib/practice.ts'), /export function resetPracticeState/);
});

/** 주석은 화면에 안 나온다 — 문구 검사에서 뺀다. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('탈퇴 화면 문구는 글이 남는다는 것을 숨기지 않는다', () => {
  // 문구는 현지화(SOMA-449)로 언어 파일에 산다 — 정본인 한국어 파일을 검사한다.
  const screen = stripComments(readSource('app/delete-account.tsx'));
  const ko = readSource('locales/ko.ts');

  assert.match(ko, /되돌릴 수 없/);
  assert.match(ko, /남는 것/);
  assert.match(ko, /탈퇴한 사용자/);
  // 서버는 글을 지우지 않는다. 지운다고 약속하면 거짓이 된다.
  assert.doesNotMatch(ko, /전부 삭제|모두 삭제|모든 (글|기록)이 삭제/);
  assert.match(ko, /계정은 그대로 있어요/);
  // 화면이 그 문구 키를 실제로 쓴다.
  assert.match(screen, /deleteAccount\.secKept/);
  assert.match(screen, /deleteAccount\.keptBody/);
  assert.match(screen, /deleteAccount\.failBody/);
});

test('설정에서 탈퇴로 들어갈 수 있다', () => {
  const settings = readSource('app/(tabs)/settings.tsx');
  const layout = readSource('app/_layout.tsx');

  assert.match(settings, /settings\.withdraw/);
  assert.match(readSource('locales/ko.ts'), /회원 탈퇴/);
  assert.match(settings, /push\('\/delete-account'\)/);
  assert.match(layout, /name="delete-account"/);
});
