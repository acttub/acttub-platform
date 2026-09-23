import { translate } from '../i18n.ts';
import type { AnalysisStatus, PracticeStatus } from './types.ts';

/**
 * 분석 진행 화면(A10)의 상태 읽기(practice.analyze).
 *
 * 화면은 회차 상태를 4초마다 읽는다. 화면을 떠나면 조회만 멈추고 작업은 서버에서 계속 돈다 —
 * 돌아오면 기다리지 않고 서버 상태부터 읽는다. "그만두기"는 취소(작업을 failed/cancelled로
 * 끝내는 것)이고 연습을 숨기지 않는다(옛 "분석 포기 = 숨김"은 없앴다).
 */
export const PRACTICE_POLL_INTERVAL_MS = 4_000;

/** 백그라운드에서 깨어난 직후 한두 번의 조회 실패는 정상이다. 연속 실패만 센다. */
export const STATUS_POLL_MAX_FAILURES = 3;

/** 통신 실패에 새 분석을 만들지 않는다. 취소·탈퇴는 다시 실행할 상태도 아니다. */
export function analysisRecoveryAction(status: PracticeStatus | null): 'reload' | 'reanalyze' | 'none' {
  const reason = status?.job?.failure_reason ?? status?.close_reason;
  if (reason === 'cancelled' || reason === 'account_deactivated') return 'none';
  return status?.job?.status === 'failed' || status?.close_reason === 'analysis_failed' ? 'reanalyze' : 'reload';
}

export type WatchOutcome =
  /** 분석이 끝났다. partial이어도 대화는 시작된다. */
  | { kind: 'ready'; analysis: AnalysisStatus }
  /** 작업이 실패로 끝났다. 취소가 아니면 "다시 시도"로 새 작업을 만들 수 있다. */
  | { kind: 'failed'; reason: string | null; retriable: boolean }
  /** 화면을 떠났다. 작업은 그대로 돌고 있다. */
  | { kind: 'stopped' }
  /** 조회가 연속으로 실패했다. */
  | { kind: 'error'; error: unknown };

export type WatchDependencies = {
  getStatus: (practiceId: string, signal: AbortSignal) => Promise<PracticeStatus>;
  delay: (ms: number, signal: AbortSignal) => Promise<void>;
  onStatus?: (status: PracticeStatus) => void;
  intervalMs?: number;
};

function aborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}

/**
 * 끝날 때까지(또는 화면을 떠날 때까지) 상태를 읽는다. 첫 조회는 기다리지 않는다 —
 * 들어오자마자, 그리고 돌아오자마자 서버 상태가 먼저다.
 */
export async function watchAnalysis(
  practiceId: string,
  signal: AbortSignal,
  dependencies: WatchDependencies,
): Promise<WatchOutcome> {
  const intervalMs = dependencies.intervalMs ?? PRACTICE_POLL_INTERVAL_MS;
  let failures = 0;
  let first = true;
  for (;;) {
    if (aborted(signal)) return { kind: 'stopped' };
    if (!first) {
      try {
        await dependencies.delay(intervalMs, signal);
      } catch {
        return { kind: 'stopped' };
      }
      if (aborted(signal)) return { kind: 'stopped' };
    }
    first = false;
    let status: PracticeStatus;
    try {
      status = await dependencies.getStatus(practiceId, signal);
      failures = 0;
    } catch (error) {
      if (aborted(signal)) return { kind: 'stopped' };
      failures += 1;
      if (failures >= STATUS_POLL_MAX_FAILURES) return { kind: 'error', error };
      continue;
    }
    if (aborted(signal)) return { kind: 'stopped' };
    dependencies.onStatus?.(status);
    if (status.stage !== 'analyzing' && status.analysis_status) {
      return { kind: 'ready', analysis: status.analysis_status };
    }
    if (status.job?.status === 'failed' || status.stage === 'closed') {
      const reason = status.job?.failure_reason ?? status.close_reason ?? null;
      return { kind: 'failed', reason, retriable: reason !== 'cancelled' && reason !== 'account_deactivated' };
    }
  }
}

/** 실패 사유를 사람 말로. 모르는 사유는 일반 문구로 떨어진다. */
export function analysisFailureMessage(reason: string | null): string {
  switch (reason) {
    case 'timeout':
      return translate('analysis.timeout');
    case 'parse':
      return translate('analysis.summarizeFail');
    case 'unsupported':
      return translate('analysis.badFormat');
    case 'cancelled':
      return translate('analysis.cancelled');
    case 'account_deactivated':
      return translate('analysis.deactivated');
    default:
      return translate('analysis.failed');
  }
}

/** 못 본 구간이 있는 분석의 안내. 채우지 않았다는 것을 그대로 알린다. */
export function analysisPartialNotice(analysis: AnalysisStatus): string | null {
  return analysis === 'partial' ? translate('analysis.partialNotice') : null;
}

export type CancelOutcome = 'cancelled' | 'already_done';

/**
 * "그만두기" — 작업을 취소로 끝낸다. 이미 끝난 뒤라면(409) 취소할 것이 없다.
 * 연습을 숨기지 않는다.
 */
export async function cancelAnalysis(
  practiceId: string,
  cancel: (practiceId: string) => Promise<unknown>,
): Promise<CancelOutcome> {
  try {
    await cancel(practiceId);
    return 'cancelled';
  } catch (error) {
    const status = error !== null && typeof error === 'object' ? (error as { status?: unknown }).status : null;
    if (status === 409 || status === 404) return 'already_done';
    throw error;
  }
}

export type AnalysisPushTarget = { practiceId: string };

/**
 * 분석 완료 푸시의 자료. 보고 있는 회차면 기다리지 않고 바로 상태를 읽고, 다른 회차면
 * 그 회차로 보낸다.
 */
export function analysisPushTarget(data: unknown): AnalysisPushTarget | null {
  if (data === null || typeof data !== 'object') return null;
  const payload = data as { kind?: unknown; type?: unknown; practice_id?: unknown };
  const kind = typeof payload.kind === 'string' ? payload.kind : payload.type;
  if (kind !== 'analysis_complete') return null;
  return typeof payload.practice_id === 'string' && payload.practice_id
    ? { practiceId: payload.practice_id }
    : null;
}
