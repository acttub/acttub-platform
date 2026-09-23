import { translate } from '../i18n.ts';
import type { NotificationGroup, NotificationKind } from './types.ts';

/**
 * 알림함(challenge.notification) — 한 줄은 묶음 하나다.
 *
 * 같은 10분 구간의 좋아요·댓글은 한 줄로 묶여 "N명이 좋아해요"·"N개의 댓글"로 보인다. 목록은
 * 묶음의 최신 사건 시각·id 역순이고 20개씩 받는다. 묶음을 누르면 포함된 사건 전부가 읽음이 되고
 * 대상으로 간다 — 대상이 보이지 않으면 "볼 수 없는 영상"만 알린다(본인 AI 리포트는 예외).
 * 읽지 않은 **묶음** 수가 탭 배지다. 토글을 꺼도 알림함에는 쌓인다.
 */
export const NOTIFICATION_PAGE_SIZE = 20;

/** 묶음 한 줄의 문구. 이름·본문은 조회 때 조립된 것만 쓴다. */
export function groupLabel(group: Pick<NotificationGroup, 'kind' | 'actor_count' | 'actor_name'>): string {
  const count = Math.max(1, group.actor_count);
  switch (group.kind) {
    case 'entry_liked':
      return translate('notifications.liked', { count });
    case 'entry_commented':
      return translate('notifications.commented', { count });
    case 'challenge_ended':
      return translate('notifications.challengeEnded');
    default:
      return translate('notifications.reportReady');
  }
}

/** 최신 사건이 위로. 같은 시각이면 group_key 로 갈라 안정적으로 둔다. */
export function sortGroups(groups: readonly NotificationGroup[]): NotificationGroup[] {
  return [...groups].sort((a, b) => {
    const at = Date.parse(b.latest_at) - Date.parse(a.latest_at);
    return at !== 0 ? at : b.group_key.localeCompare(a.group_key);
  });
}

/** 탭 배지는 읽지 않은 사건 수가 아니라 **묶음** 수다. */
export function unreadBadge(groups: readonly NotificationGroup[]): number {
  return groups.filter((group) => !group.read).length;
}

/** 배지 표시 문구 — 99를 넘으면 99+ 다. 0이면 배지를 달지 않는다. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

export type NotificationTarget =
  | { kind: 'entry'; challengeId: string; entryId: string }
  | { kind: 'challenge'; challengeId: string }
  | { kind: 'report'; entryId: string }
  | { kind: 'unavailable' };

/**
 * 묶음을 눌렀을 때 갈 곳. 대상이 보이지 않으면 안내만 한다 — 다만 내가 요청한 AI 리포트는
 * 비공개 참여작이어도 열린다.
 */
export function targetOf(group: NotificationGroup): NotificationTarget {
  if (group.kind === 'entry_ai_report_ready') {
    return group.entry_id ? { kind: 'report', entryId: group.entry_id } : { kind: 'unavailable' };
  }
  if (!group.target_available) return { kind: 'unavailable' };
  if (group.kind === 'challenge_ended') {
    return group.challenge_id ? { kind: 'challenge', challengeId: group.challenge_id } : { kind: 'unavailable' };
  }
  return group.challenge_id && group.entry_id
    ? { kind: 'entry', challengeId: group.challenge_id, entryId: group.entry_id }
    : { kind: 'unavailable' };
}

export function unavailableMessage(): string {
  return translate('notifications.unavailable');
}

/** 묶음을 읽음으로 표시한 목록(화면이 바로 반영한다). */
export function markGroupRead(
  groups: readonly NotificationGroup[],
  groupKey: string,
): NotificationGroup[] {
  return groups.map((group) => (group.group_key === groupKey ? { ...group, read: true } : group));
}

/**
 * "모두 읽음"은 요청 시각까지의 것만 읽음으로 바꾼다 — 그 뒤 도착한 알림은 읽지 않음으로 남는다.
 */
export function markAllRead(
  groups: readonly NotificationGroup[],
  before: { at: string; groupKey: string },
): NotificationGroup[] {
  const cutoff = Date.parse(before.at);
  return groups.map((group) => {
    const at = Date.parse(group.latest_at);
    const older = at < cutoff || (at === cutoff && group.group_key <= before.groupKey);
    return older ? { ...group, read: true } : group;
  });
}

/** 챌린지 알림 토글이 꺼져 있으면 알림함 머리에 그렇게 알린다(알림함에는 쌓인다). */
export function toggleOffNotice(enabled: boolean): string | null {
  return enabled ? null : translate('notifications.pushOff');
}

export type ChallengePushTarget = { groupKey: string } | { notificationId: string };

/**
 * 푸시를 눌렀을 때 — 잠금 화면 문구에는 이름·본문이 없고 알림 식별자만 있다. 그 식별자로
 * 알림함을 열어 대상으로 간다.
 */
export function challengePushTarget(data: unknown): ChallengePushTarget | null {
  if (data === null || typeof data !== 'object') return null;
  const payload = data as { kind?: unknown; type?: unknown; group_key?: unknown; notification_id?: unknown };
  const kind = typeof payload.kind === 'string' ? payload.kind : payload.type;
  if (kind !== 'challenge_notification') return null;
  if (typeof payload.group_key === 'string' && payload.group_key) return { groupKey: payload.group_key };
  if (typeof payload.notification_id === 'string' && payload.notification_id) {
    return { notificationId: payload.notification_id };
  }
  return null;
}

/** 알림함에서 쓰는 사건 종류 목록(테스트·문구 점검용). */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'entry_liked',
  'entry_commented',
  'challenge_ended',
  'entry_ai_report_ready',
];
