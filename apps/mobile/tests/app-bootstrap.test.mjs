import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recoveryStatusForConsentGate,
  resolveAnalyzingBootstrapRoute,
  resolveBootstrapStep,
  resolvePostConsentRoute,
  routeAllowedWhileConsentBlocked,
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

test('확인 전에는 서비스로 가지 않고 동의 진입 세 결과를 각 표면으로 보낸다', () => {
  const base = {
    authStatus: 'signedIn',
    userId: 'user-1',
    profileSetupRequired: false,
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
    resolveBootstrapStep({ ...base, consentEntryStatus: 'blocked' }),
    { stage: 'blocked-gate', route: '/settings' },
  );
  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'allowed' }),
    { stage: 'done', route: '/(tabs)' },
  );
});

test('동의 뒤에는 중단 화면으로 돌아가되 pending 분석 복구를 우선한다', () => {
  const interruptedRoute = {
    pathname: '/community-post',
    params: { id: 'post-1' },
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

test('차단 상태에서는 설정과 회원 탈퇴만 남기고 서비스 화면은 제한한다', () => {
  assert.equal(routeAllowedWhileConsentBlocked(['(tabs)', 'settings']), true);
  assert.equal(routeAllowedWhileConsentBlocked(['delete-account']), true);
  assert.equal(routeAllowedWhileConsentBlocked(['(tabs)', 'index']), false);
  assert.equal(routeAllowedWhileConsentBlocked(['upload']), false);
});

test('이름 수집은 동의 확인과 분리해 허용 판정 뒤에만 진행한다', () => {
  const base = {
    authStatus: 'signedIn',
    userId: 'user-1',
    recoveryStatus: 'ready',
    recoveryOwner: 'user-1',
    pending: null,
    profileSetupRequired: true,
  };

  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'decision_required' }),
    { stage: 'consent-gate', route: '/consent' },
  );
  assert.deepEqual(
    resolveBootstrapStep({ ...base, consentEntryStatus: 'allowed' }),
    { stage: 'profile-gate', route: '/profile-name' },
  );
});
