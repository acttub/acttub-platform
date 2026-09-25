import { translate } from '../i18n.ts';
import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  type BlockedUser,
  type ReportBody,
  type ReportReason,
  type ReportTarget,
} from './types.ts';

/**
 * 신고(challenge.report)와 사람 차단(challenge.block).
 *
 * 신고는 운영에 알리는 것이고 차단은 내 화면의 일이다 — 둘은 서로를 대신하지 않는다(ADR-032).
 * 참여작·댓글은 접수 즉시 숨겨지고 챌린지는 신고가 쌓이면 검토로 넘어간다(서버 판단).
 * 차단은 양방향 숨김이라 차단한 순간 그 사람의 참여작·댓글이 내 화면에서 사라진다.
 */

// ─── 신고 ─────────────────────────────────────────────────────────────────────

export { REPORT_REASONS };

/** 기타를 고르면 메모를 받는다(200자, 선택). */
export function needsNote(reason: ReportReason): boolean {
  return reason === 'other';
}

export function noteTooLong(note: string): boolean {
  return [...note.trim()].length > REPORT_NOTE_MAX;
}

export function canSendReport(input: { reason: ReportReason | null; note: string }): boolean {
  return input.reason !== null && !noteTooLong(input.note);
}

export function buildReportBody(input: {
  requestId: string;
  target: ReportTarget;
  targetId: string;
  reason: ReportReason;
  note: string;
}): ReportBody {
  const body: ReportBody = {
    request_id: input.requestId,
    target_type: input.target,
    target_id: input.targetId,
    reason: input.reason,
  };
  const note = input.note.trim();
  if (note) body.note = note;
  return body;
}

export type ReportFailure =
  /** 본인 콘텐츠는 신고할 수 없다. */
  | { kind: 'self' }
  | { kind: 'daily_limit' }
  /** 볼 수 없는 대상·없는 대상. */
  | { kind: 'not_found' }
  | { kind: 'invalid' }
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

export function reportFailure(error: unknown): ReportFailure {
  const code = codeOf(error);
  const status = statusOf(error);
  if (code === 'self_report') return { kind: 'self' };
  if (code === 'daily_report_limit' || status === 429) return { kind: 'daily_limit' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 422) return { kind: 'invalid' };
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  if (name === 'NetworkError' || status === null || (status >= 500 && status <= 599)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function reportFailureMessage(failure: ReportFailure): string {
  switch (failure.kind) {
    case 'self':
      return translate('videoReport.errSelf');
    case 'daily_limit':
      return translate('videoReport.errDailyLimit');
    case 'not_found':
      return translate('react.gone');
    case 'invalid':
      return translate('videoReport.errInvalid');
    case 'offline':
      return translate('challenges.offline');
    default:
      return translate('videoReport.errOther');
  }
}

/** 접수 뒤 안내 — 참여작·댓글은 바로 숨겨지고 챌린지는 운영이 본다. */
export function reportDoneMessage(target: ReportTarget): string {
  return target === 'challenge'
    ? translate('videoReport.doneChallenge')
    : translate('videoReport.doneMessage');
}

// ─── 차단 ─────────────────────────────────────────────────────────────────────

/** 자기 자신은 차단할 수 없다. */
export function canBlock(input: { authorId: string | null; myId: string | null }): boolean {
  return Boolean(input.authorId) && input.authorId !== input.myId;
}

/**
 * 차단한 순간 그 사람의 것을 화면에서 지운다. 서버 목록도 다음 조회부터 빠지지만, 지금 보고
 * 있는 목록에서 바로 사라지게 한다.
 */
export function removeAuthored<T extends { author?: { user_id?: string | null } }>(
  items: readonly T[],
  blockedUserId: string,
): T[] {
  return items.filter((item) => item.author?.user_id !== blockedUserId);
}

export function blockFailureMessage(error: unknown): string {
  const code = codeOf(error);
  const status = statusOf(error);
  if (code === 'self_block') return translate('block.errSelf');
  if (status === 404) return translate('block.errMissing');
  return translate('block.errOther');
}

/** 차단 목록의 아바타는 이름 첫 글자다(상대에게는 아무 표시도 가지 않는다). */
export function blockedLabel(user: Pick<BlockedUser, 'name'>): string {
  return user.name.trim() || translate('comments.withdrawn');
}
