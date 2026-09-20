import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recoveryStatusForConsentGate,
  resolveAnalyzingBootstrapRoute,
  resolveBootstrapStep,
  resolvePostConsentRoute,
  routeAllowedDuringConsentGate,
} from '../lib/app-bootstrap.ts';

function pending(owner = 'user-1', sessionId = 'session-1') {
  return {
    key: `pending:${owner}:${sessionId}:scope`,
    record: { schemaVersion: 1, owner, session_id: sessionId },
  };
}

test('동의 게이트가 끝나면 같은 세션의 pending 분석을 복구한다', () => {
  const pendingAnalysis = pending();
  const base = {
    authStatus: 'signedIn',
    userId: 'user-1',
    profileStatus: 'complete',
    recoveryStatus: 'ready',
    recoveryOwner: 'user-1',
    pending: pendingAnalysis,
  };

  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'decision_required' }),
    { stage: 'consent-gate', route: '/consent' },
  );
  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'allowed' }),
    {
      stage: 'done',
      route: {
        pathname: '/analyzing',
        params: {
          recoveryKey: pendingAnalysis.key,
          sessionId: 'session-1',
        },
      },
    },
  );
});

test('계정이 바뀌면 현재 owner의 pending 복구가 준비될 때까지 기다린다', () => {
  assert.deepEqual(
    resolveBootstrapStep({
      authStatus: 'signedOut',
      userId: null,
      consentEntryStatus: 'allowed',
      profileStatus: 'complete',
      recoveryStatus: 'ready',
      recoveryOwner: null,
      pending: null,
    }),
    { stage: 'auth-gate', route: '/login' },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      authStatus: 'signedIn',
      userId: 'user-1',
      consentEntryStatus: 'allowed',
      profileStatus: 'complete',
      recoveryStatus: 'ready',
      recoveryOwner: null,
      pending: null,
    }),
    { stage: 'pending-recovery', route: null },
  );
});

test('동의 전환 뒤 stale recovery snapshot으로 tabs를 결정하지 않는다', () => {
  const staleStatus = recoveryStatusForConsentGate(
    { status: 'ready', consentGate: 1 },
    2,
  );
  assert.equal(staleStatus, 'loading');
  assert.deepEqual(
    resolveBootstrapStep({
      authStatus: 'signedIn',
      userId: 'user-1',
      consentEntryStatus: 'allowed',
      profileStatus: 'complete',
      recoveryStatus: staleStatus,
      recoveryOwner: 'user-1',
      pending: null,
    }),
    { stage: 'pending-recovery', route: null },
  );
});

test('analyzing 복구 경로는 pathname과 params가 모두 같아야 완료한다', () => {
  const target = {
    pathname: '/analyzing',
    params: {
      recoveryKey: 'pending:user-1:session-1:scope',
      sessionId: 'session-1',
    },
  };

  assert.equal(resolveAnalyzingBootstrapRoute('/analyzing', {}, target), 'replace');
  assert.equal(
    resolveAnalyzingBootstrapRoute(
      '/analyzing',
      { recoveryKey: 'pending:stale', sessionId: 'session-old' },
      target,
    ),
    'replace',
  );
  assert.equal(
    resolveAnalyzingBootstrapRoute('/analyzing', target.params, target),
    'complete',
  );
});

test('account.login: 확인 전에는 서비스로 가지 않고 동의 진입 결과를 각 표면으로 보낸다', () => {
  const base = {
    authStatus: 'signedIn',
    userId: 'user-1',
    profileStatus: 'complete',
    recoveryStatus: 'ready',
    recoveryOwner: 'user-1',
    pending: null,
  };

  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'checking' }),
    { stage: 'consent-gate', route: null },
  );
  for (const consentEntryStatus of ['error', 'decision_required']) {
    assert.deepEqual(
      resolveBootstrapStep({ ...base, consentEntryStatus }),
      { stage: 'consent-gate', route: '/consent' },
    );
  }
  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'allowed' }),
    { stage: 'done', route: '/(tabs)' },
  );
});

test('동의 뒤에는 중단 화면으로 돌아가되 pending 분석 복구를 우선한다', () => {
  const interruptedRoute = {
    pathname: '/archive-detail',
    params: { id: 'practice-1' },
  };
  assert.deepEqual(
    resolvePostConsentRoute('/(tabs)', interruptedRoute),
    interruptedRoute,
  );

  const pendingRoute = {
    pathname: '/analyzing',
    params: {
      recoveryKey: 'pending:user-1:session-1:scope',
      sessionId: 'session-1',
    },
  };
  assert.deepEqual(
    resolvePostConsentRoute(pendingRoute, interruptedRoute),
    pendingRoute,
  );
});

test('account.consent: 재동의 화면에서는 탈퇴 화면만 열어 두고 서비스 화면은 막는다', () => {
  assert.equal(routeAllowedDuringConsentGate(['delete-account']), true);
  assert.equal(routeAllowedDuringConsentGate(['(tabs)', 'settings']), false);
  assert.equal(routeAllowedDuringConsentGate(['settings']), false);
  assert.equal(routeAllowedDuringConsentGate(['(tabs)', 'index']), false);
  assert.equal(routeAllowedDuringConsentGate(['upload']), false);
});

const gateBase = {
  authStatus: 'signedIn',
  userId: 'user-1',
  recoveryStatus: 'ready',
  recoveryOwner: 'user-1',
  pending: null,
};

test('account.profile: 게이트 순서는 인증 → 동의 → 프로필 → 탭이다', () => {
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      authStatus: 'signedOut',
      userId: null,
      consentEntryStatus: 'decision_required',
      profileStatus: 'required',
    }),
    { stage: 'auth-gate', route: '/login' },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      consentEntryStatus: 'decision_required',
      profileStatus: 'required',
    }),
    { stage: 'consent-gate', route: '/consent' },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      consentEntryStatus: 'allowed',
      profileStatus: 'required',
    }),
    { stage: 'profile-gate', route: '/profile-name' },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      consentEntryStatus: 'allowed',
      profileStatus: 'complete',
    }),
    { stage: 'done', route: '/(tabs)' },
  );
});

test('account.profile: 프로필 상태를 확인하기 전에는 탭으로 가지 않고, 확인에 실패하면 프로필 화면에서 다시 시도한다', () => {
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      consentEntryStatus: 'allowed',
      profileStatus: 'checking',
    }),
    { stage: 'profile-gate', route: null },
  );
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      consentEntryStatus: 'allowed',
      profileStatus: 'error',
    }),
    { stage: 'profile-gate', route: '/profile-name' },
  );
});

test('account.profile: 프로필이 비어 있으면 중단된 분석 복구보다 프로필 입력이 먼저다', () => {
  assert.deepEqual(
    resolveBootstrapStep({
      ...gateBase,
      consentEntryStatus: 'allowed',
      profileStatus: 'required',
      pending: pending(),
    }),
    { stage: 'profile-gate', route: '/profile-name' },
  );
});

test('account.login: 처음 온 신원은 계정 없이 동의 화면으로 가고, 나가면 로그인 화면이다', () => {
  const signedOut = {
    ...gateBase,
    authStatus: 'signedOut',
    userId: null,
    consentEntryStatus: 'checking',
    profileStatus: 'checking',
    recoveryOwner: null,
  };

  assert.deepEqual(
    resolveBootstrapStep({ ...signedOut, signupPending: true }),
    { stage: 'signup-gate', route: '/consent' },
  );
  assert.deepEqual(
    resolveBootstrapStep({ ...signedOut, signupPending: false }),
    { stage: 'auth-gate', route: '/login' },
  );
});

test('공통 규칙: 426을 받은 뒤에는 로그인 여부와 무관하게 업데이트 안내 화면만 보인다', () => {
  for (const authStatus of ['loading', 'signedOut', 'signedIn']) {
    assert.deepEqual(
      resolveBootstrapStep({
        ...gateBase,
        authStatus,
        consentEntryStatus: 'allowed',
        profileStatus: 'complete',
        updateRequired: true,
      }),
      { stage: 'update-gate', route: '/update-required' },
    );
  }
});
