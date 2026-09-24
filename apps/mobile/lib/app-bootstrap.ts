import type { PendingAnalysisHandle } from './pending-analysis.ts';

export type BootstrapRoute =
  | '/update-required'
  | '/login'
  | '/consent'
  | '/profile-name'
  | '/(tabs)'
  | {
      pathname: '/analyzing';
      params: {
        recoveryKey: string;
        practiceId: string;
      };
    };

export type BootstrapRecoveryParams = {
  recoveryKey?: string | string[];
  practiceId?: string | string[];
};

export function resolveAnalyzingBootstrapRoute(
  pathname: string,
  currentParams: BootstrapRecoveryParams,
  target: Extract<BootstrapRoute, { pathname: '/analyzing' }>,
): 'replace' | 'complete' {
  return pathname === target.pathname &&
    currentParams.recoveryKey === target.params.recoveryKey &&
    currentParams.practiceId === target.params.practiceId
    ? 'complete'
    : 'replace';
}

export type BootstrapStage =
  | 'update-gate'
  | 'auth-gate'
  | 'signup-gate'
  | 'consent-gate'
  | 'profile-gate'
  | 'pending-recovery'
  | 'done';

export type ConsentEntryGateStatus =
  | 'checking'
  | 'error'
  | 'allowed'
  | 'decision_required';

/** 서버의 profile_complete를 읽은 결과. 읽기 전(checking)에는 탭으로 보내지 않는다. */
export type ProfileGateStatus = 'checking' | 'error' | 'required' | 'complete';

export type BootstrapStepInput = {
  /** 426을 받았다. 이 빌드로는 더 쓸 수 없어 다른 모든 판정보다 먼저다. */
  updateRequired?: boolean;
  authStatus: 'loading' | 'signedIn' | 'signedOut' | 'guest';
  /** 처음 온 신원이 가입 토큰을 들고 동의 화면에 있다. 계정은 아직 없다. */
  signupPending?: boolean;
  userId: string | null;
  consentEntryStatus: ConsentEntryGateStatus;
  profileStatus: ProfileGateStatus;
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

/** update → auth → consent → profile → owner별 pending recovery 순서로만 done에 도달한다. */
/**
 * 루트 게이트가 "이미 보낸 세션인가"를 가르는 키. 키가 없으면 게이트는 기다린다(아무 데도 보내지 않는다).
 *
 * 둘러보기(guest)에도 키를 준다. 로그인 화면에서 "로그인 없이 둘러보기"를 누르면 상태만 guest 로
 * 바뀌고 이동은 게이트가 하는데, guest 의 키가 null 이던 동안 게이트가 멈춰 로그인 화면에 갇혔다
 * (SOMA-544). 로그인했지만 사용자를 아직 못 읽었거나 앱이 켜지는 중이면 키가 없다.
 */
export function bootstrapSessionKey(
  status: BootstrapStepInput['authStatus'],
  userId: string | null,
): string | null {
  if (status === 'signedIn') return userId ? `signedIn:${userId}` : null;
  if (status === 'signedOut') return 'signedOut';
  if (status === 'guest') return 'guest';
  return null;
}

export function resolveBootstrapStep(input: BootstrapStepInput): BootstrapStep {
  if (input.updateRequired) {
    return { stage: 'update-gate', route: '/update-required' };
  }
  if (input.authStatus === 'loading') {
    return { stage: 'auth-gate', route: null };
  }
  // 둘러보기는 계정이 없다 — 동의도 프로필도 계정을 만들 때 받는다 (SOMA-544).
  // 여기서 막으면 로그인 없이 볼 수 있다던 약속이 깨진다.
  if (input.authStatus === 'guest') {
    return { stage: 'done', route: '/(tabs)' };
  }
  if (input.authStatus === 'signedOut') {
    return input.signupPending
      ? { stage: 'signup-gate', route: '/consent' }
      : { stage: 'auth-gate', route: '/login' };
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
  if (input.profileStatus === 'checking') {
    return { stage: 'profile-gate', route: null };
  }
  if (input.profileStatus === 'error' || input.profileStatus === 'required') {
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
          practiceId: input.pending.record.practice_id,
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

/**
 * 재동의 화면에서 열어 두는 화면은 탈퇴뿐이다. 필수 문서에 거절이 없고 설정은 동의 화면
 * 뒤에 있어서, 동의하지 않는 사람이 떠나는 길이 이것 하나다.
 */
export function routeAllowedDuringConsentGate(
  segments: readonly string[],
): boolean {
  return segments[0] === 'delete-account';
}
