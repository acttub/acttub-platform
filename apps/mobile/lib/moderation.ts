/**
 * 게시판 신고·차단 (SOMA-444) — 웹 moderation.tsx의 앱 판.
 * 값은 서버 enum(/v2/community/reports)과 같아야 한다.
 */

import { translate } from './i18n.ts';

export type ReportTargetType = 'post' | 'comment';
export type ReportReason = 'spam' | 'abuse' | 'sexual' | 'privacy' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: translate('moderation.spam') },
  { value: 'abuse', label: translate('moderation.abuse') },
  { value: 'sexual', label: translate('moderation.sexual') },
  { value: 'privacy', label: translate('moderation.privacy') },
  { value: 'other', label: translate('moderation.other') },
];

/**
 * 차단할 수 있으면 상대 사용자 id, 아니면 null.
 * 익명 글엔 author.id가 아예 안 온다 — 화면만 가리고 id를 쓰면 익명이 깨지기 때문.
 * 내 글은 차단 대상이 아니다.
 */
export function blockableUserId(
  author: { id?: string | null } | null | undefined,
  options: { anonymous: boolean; mine?: boolean },
): string | null {
  if (options.anonymous || options.mine) return null;
  return author?.id ?? null;
}

export type ReportPayload = {
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  detail: string | null;
};

export function reportPayload(input: {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail?: string | null;
}): ReportPayload {
  const detail = input.detail?.trim();
  return {
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    detail: detail ? detail.slice(0, 500) : null,
  };
}
