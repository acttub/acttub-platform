import { translate } from '../i18n.ts';
import {
  AI_REPORT_DAILY_LIMIT,
  AI_REPORT_MIN_SAMPLES,
  type AiReport,
  type AiReportStatus,
  type ReportEvidence,
} from './types.ts';

/**
 * 챌린지 AI 리포트(challenge.ai-report) — 같은 대사의 다른 참여작을 표본으로 두고 내 영상의
 * 관찰과 표현 차이를 설명한다.
 *
 * 랭킹과 다른 것이다. 사람의 반응이 아니라 관찰이고, **점수·백분위·등급·순위·재능 판정을 내지
 * 않는다**(ADR-005 개정). 표본이 3개 미만이면 견주기 없이 관찰만 보이고 "비교할 영상이 아직
 * 부족해요"라고 말한다. 표본은 이름·id 없이 "다른 참여작들"로만 나온다.
 */
export { AI_REPORT_DAILY_LIMIT, AI_REPORT_MIN_SAMPLES };

export type ReportSection =
  | { kind: 'observations'; label: string; items: ReportEvidence[] }
  | { kind: 'comparisons'; label: string; items: string[]; notice: string | null }
  | { kind: 'limits'; label: string; items: string[] }
  | { kind: 'suggestion'; label: string; text: string | null };

/** 화면 순서는 관찰 → 견주기 → 한계 → 다음 시도다. */
export function reportSections(report: AiReport): ReportSection[] {
  return [
    { kind: 'observations', label: translate('aiReport.observations'), items: report.observations },
    {
      kind: 'comparisons',
      label: translate('aiReport.comparisons'),
      items: report.comparisons,
      notice: sampleNotice(report),
    },
    { kind: 'limits', label: translate('aiReport.limits'), items: report.limits },
    { kind: 'suggestion', label: translate('aiReport.suggestion'), text: report.suggestion?.trim() || null },
  ];
}

/** 표본이 모자라면 그렇게 말한다. 없는 비교를 만들어 내지 않는다. */
export function sampleNotice(report: Pick<AiReport, 'sample_count'>): string | null {
  return report.sample_count < AI_REPORT_MIN_SAMPLES ? translate('aiReport.notEnoughSamples') : null;
}

/** 근거 구간을 그 자리부터 다시 보게 하는 시작 시각(초). */
export function evidenceStartSeconds(evidence: Pick<ReportEvidence, 'start_ms'>): number {
  return Math.max(0, Math.floor(evidence.start_ms / 1000));
}

export function evidenceLabel(evidence: Pick<ReportEvidence, 'start_ms' | 'end_ms'>): string {
  const format = (ms: number) => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  return `${format(evidence.start_ms)}–${format(evidence.end_ms)}`;
}

export function statusMessage(status: AiReportStatus): string {
  switch (status) {
    case 'pending':
      return translate('aiReport.pending');
    case 'failed':
      return translate('aiReport.failed');
    default:
      return translate('aiReport.ready');
  }
}

/** 요청 버튼을 보일지 — 아직 만든 적이 없거나 실패한 뒤 다시 시도할 때다. */
export function canRequest(report: AiReport | null): boolean {
  return report === null || report.status === 'failed';
}

/** 다시 시도는 새 생성이라 하루 한도를 쓴다 — 누르기 전에 그렇게 알린다. */
export function requestNotice(report: AiReport | null): string {
  return report?.status === 'failed' ? translate('aiReport.retryNotice') : translate('aiReport.dailyNotice');
}

export type ReportFailureKind =
  /** 하루 3회를 다 썼다. */
  | { kind: 'daily_limit' }
  /** 파일만 파기한 참여작이라 만들 수 없다. */
  | { kind: 'video_not_ready' }
  /** 남의 리포트이거나 지워진 참여작. */
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'other' };

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function statusOf(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function reportRequestFailure(error: unknown): ReportFailureKind {
  const code = codeOf(error);
  const status = statusOf(error);
  if (code === 'daily_report_request_limit' || status === 429) return { kind: 'daily_limit' };
  if (code === 'video_not_ready') return { kind: 'video_not_ready' };
  if (status === 404) return { kind: 'not_found' };
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  if (name === 'NetworkError' || status === null || (status >= 500 && status <= 599)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function reportRequestFailureMessage(failure: ReportFailureKind): string {
  switch (failure.kind) {
    case 'daily_limit':
      return translate('aiReport.errDailyLimit');
    case 'video_not_ready':
      return translate('aiReport.errVideoNotReady');
    case 'not_found':
      return translate('react.gone');
    case 'offline':
      return translate('challenges.offline');
    default:
      return translate('aiReport.errOther');
  }
}
