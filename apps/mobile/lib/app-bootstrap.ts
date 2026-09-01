import type { PendingAnalysisHandle } from './pending-analysis.ts';

export type BootstrapRoute =
  | '/login'
  | '/consent'
  | '/profile-name'
  | '/settings'
  | '/(tabs)'
  | {
      pathname: '/analyzing';
      params: {
        recoveryKey: string;
        sessionId: string;
      };
    };

export type BootstrapRecoveryParams = {
  recoveryKey?: string | string[];
  sessionId?: string | string[];
};

export function resolveAnalyzingBootstrapRoute(
  pathname: string,
  currentParams: BootstrapRecoveryParams,
  target: Extract<BootstrapRoute, { pathname: '/analyzing' }>,
): 'replace' | 'complete' {
  return pathname === target.pathname &&
    currentParams.recoveryKey === target.params.recoveryKey &&
    currentParams.sessionId === target.params.sessionId
    ? 'complete'
    : 'replace';
}

export type BootstrapStage =
  | 'auth-gate'
  | 'consent-gate'
  | 'blocked-gate'
  | 'profile-gate'
  | 'pending-recovery'
  | 'done';

export type ConsentEntryGateStatus =
  | 'checking'
  | 'error'
  | 'allowed'
  | 'decision_required'
  | 'blocked';

export type BootstrapStepInput = {
  authStatus: 'loading' | 'signedIn' | 'signedOut';
  userId: string | null;
  consentEntryStatus: ConsentEntryGateStatus;
  profileSetupRequired?: boolean;
  recoveryStatus: 'loading' | 'ready';
  recoveryOwner: string | null;
  pending: PendingAnalysisHandle | null;
};

export type BootstrapStep = {
  stage: BootstrapStage;
  route: BootstrapRoute | null;
};

export type RecoveryConsentGate = string | number | boolean | null;

export function recoveryStatusForConsentGate(
  recovery: {
    status: 'loading' | 'ready';
    consentGate: RecoveryConsentGate;
  },
  currentConsentGate: RecoveryConsentGate,
): 'loading' | 'ready' {
  return recovery.consentGate === currentConsentGate
    ? recovery.status
    : 'loading';
}

/** auth → consent → profile → owner별 pending recovery 순서로만 done에 도달한다. */
export function resolveBootstrapStep(input: BootstrapStepInput): BootstrapStep {
  if (input.authStatus === 'loading') {
    return { stage: 'auth-gate', route: null };
  }
  if (input.authStatus === 'signedOut') {
    return { stage: 'auth-gate', route: '/login' };
  }
  if (!input.userId) {
    return { stage: 'auth-gate', route: null };
  }
  if (input.consentEntryStatus === 'checking') {
    return { stage: 'consent-gate', route: null };
  }
  if (
    input.consentEntryStatus === 'error' ||
    input.consentEntryStatus === 'decision_required'
  ) {
    return { stage: 'consent-gate', route: '/consent' };
  }
  if (input.consentEntryStatus === 'blocked') {
    return { stage: 'blocked-gate', route: '/settings' };
  }
  if (input.profileSetupRequired) {
    return { stage: 'profile-gate', route: '/profile-name' };
  }
  if (
    input.recoveryStatus !== 'ready' ||
    input.recoveryOwner !== input.userId
  ) {
    return { stage: 'pending-recovery', route: null };
  }
  if (input.pending) {
    return {
      stage: 'done',
      route: {
        pathname: '/analyzing',
        params: {
          recoveryKey: input.pending.key,
          sessionId: input.pending.record.session_id,
        },
      },
    };
  }
  return { stage: 'done', route: '/(tabs)' };
}

export type InterruptedRoute =
  | string
  | {
      pathname: string;
      params?: Record<
        string,
        string | number | (string | number)[] | null | undefined
      >;
    };

export function resolvePostConsentRoute(
  bootstrapRoute: BootstrapRoute,
  interruptedRoute: InterruptedRoute | null,
): BootstrapRoute | InterruptedRoute {
  return bootstrapRoute === '/(tabs)' && interruptedRoute
    ? interruptedRoute
    : bootstrapRoute;
}

export function routeAllowedWhileConsentBlocked(
  segments: readonly string[],
): boolean {
  return (
    (segments[0] === '(tabs)' && segments[1] === 'settings') ||
    segments[0] === 'delete-account'
  );
}
