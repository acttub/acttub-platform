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

  // 탈퇴는 처음이든 다시든 200 과 최초 탈퇴 시각을 돌려준다(204 가 아니다).
  assert.match(source, /deleteMe\(\): Promise<\{ status: 'deactivated'; deactivated_at: string \}>/);
  assert.match(source, /request\('\/v2\/me',\s*\{ method: 'DELETE' \}/);
  assert.match(source, /emitAccountDeactivated,/);
});

// 탈퇴·로그아웃의 순서와 "계정이 사라졌을 때 기기 비우기"는 소스 문자열이 아니라 동작으로 검사한다:
// 순서와 실패 허용은 auth-session.test, 기기에서 지우는 것과 남기는 것은 local-account-wipe.test ·
// device-files.test, 알람과 푸시 토큰은 notification-sync.test · reminder-schedule.test ·
// push-token-lifecycle.test.

/** 주석은 화면에 안 나온다 — 문구 검사에서 뺀다. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('account.withdraw: 탈퇴 화면은 지워지는 것과 남는 것을 챌린지 기준으로 숨김없이 적는다', async () => {
  // 문구는 현지화(SOMA-449)로 언어 파일에 산다 — 정본인 한국어 파일을 검사한다.
  const screen = stripComments(readSource('app/delete-account.tsx'));
  const { default: ko } = await import('../locales/ko.ts');
  const text = ko.deleteAccount;

  assert.match(text.title, /되돌릴 수 없/);
  // 지워지는 것: 이메일·이름·사진·소개, 포트폴리오와 공유 링크, 소셜 로그인 연결,
  // 영상과 녹음(보관에 동의했으면 3년 뒤), 이 기기의 자료.
  assert.match(text.bulletIdentity, /이메일/);
  assert.match(text.bulletIdentity, /이름/);
  assert.match(text.bulletIdentity, /사진/);
  assert.match(text.bulletIdentity, /소개/);
  assert.match(text.bulletPortfolio, /포트폴리오/);
  assert.match(text.bulletPortfolio, /공유 링크/);
  assert.match(text.bulletSocial, /소셜 로그인 연결/);
  assert.match(text.bulletMedia, /영상/);
  assert.match(text.bulletMedia, /녹음/);
  assert.match(text.bulletMedia, /3년/);
  assert.match(text.bulletLocal, /이 기기/);
  // 남는 것: 연습 기록은 나와 끊겨 남고, 챌린지 참여작은 비공개로, 댓글은 "탈퇴한 사용자"로.
  assert.equal(text.secKept, '남는 것');
  assert.match(text.keptPractice, /연습 기록/);
  assert.match(text.keptChallenge, /비공개/);
  assert.match(text.keptComment, /탈퇴한 사용자/);
  // 서버는 행을 지우지 않는다. 지운다고 약속하면 거짓이 된다. 커뮤니티는 1.0.0에 없다.
  const all = Object.values(text).join(' ');
  assert.doesNotMatch(all, /전부 삭제|모두 삭제|모든 (글|기록)이 삭제|커뮤니티|게시판/);
  assert.match(text.failBody, /계정은 그대로 있어요/);
  // 화면이 그 문구 키를 실제로 쓴다.
  for (const key of [
    'bulletIdentity', 'bulletPortfolio', 'bulletSocial', 'bulletMedia', 'bulletLocal',
    'secKept', 'keptPractice', 'keptChallenge', 'keptComment', 'failBody',
  ]) {
    assert.match(screen, new RegExp(`deleteAccount\\.${key}\\b`), key);
  }
});

test('account.withdraw: "연습·노트는 돌아오지 않아요"를 확인받고, 확인 창까지 두 번 거쳐야 탈퇴한다', async () => {
  const screen = stripComments(readSource('app/delete-account.tsx'));
  const { default: ko } = await import('../locales/ko.ts');

  assert.equal(ko.deleteAccount.acknowledge, '연습·노트는 돌아오지 않아요');
  assert.match(screen, /deleteAccount\.acknowledge/);
  // 확인 줄을 누르기 전에는 탈퇴 버튼이 눌리지 않는다.
  assert.match(screen, /disabled=\{!acknowledged \|\| working\}/);
  // 두 번째 확인은 확인 창이다.
  assert.match(screen, /await confirm\(\{/);
  assert.ok(screen.indexOf('await confirm({') < screen.indexOf('await deleteAccount()'));
});

test('설정에서 탈퇴로 들어갈 수 있다', () => {
  const settings = readSource('app/settings.tsx');
  const layout = readSource('app/_layout.tsx');

  assert.match(settings, /settings\.withdraw/);
  assert.match(readSource('locales/ko.ts'), /회원 탈퇴/);
  assert.match(settings, /push\('\/delete-account'\)/);
  assert.match(layout, /name="delete-account"/);
});
