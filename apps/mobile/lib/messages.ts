/**
 * 배우끼리 1:1 메시지(SOMA-1039, docs/specs/community/messages.md) — 서버 모양과 화면 규칙.
 *
 * 대화는 게시판 글·댓글의 작성자 이름에서만 시작한다. 서버는 메시지를 최근 것부터 주고, 대화방은 오래된 것이 위로 오게
 * 뒤집어 그린다. 보내는 중인 말풍선은 기기에만 있다가(흐리게) 서버 답으로 바뀌고, 실패하면 「다시 보내기」를 단다.
 * 같은 말풍선을 다시 보낼 때는 처음 만든 요청 id 를 그대로 써서 두 번 저장되지 않게 한다.
 */

import { errorCode, errorStatus } from './api-request.ts';
import { postedAtLabel } from './time-label.ts';

export type DirectPartner = { id: string; name: string; photo_url: string | null; withdrawn: boolean };

export type DirectConversation = {
  id: string;
  partner: DirectPartner;
  origin_post: { id: string; title: string } | null;
  can_send: boolean;
  unavailable_reason: 'partner_unavailable' | 'message_blocked' | null;
  created_at: string;
  last_message_at: string | null;
};

export type DirectConversationSummary = {
  id: string;
  partner: DirectPartner;
  last_message: { preview: string; mine: boolean; created_at: string } | null;
  unread_count: number;
  last_message_at: string | null;
};

export type DirectMessage = { id: string; conversation_id: string; body: string; mine: boolean; created_at: string };

export type DirectConversationList = { conversations: DirectConversationSummary[]; next_cursor: string | null };
export type DirectMessageList = { messages: DirectMessage[]; next_cursor: string | null };

/** 서버와 같은 본문 한도(코드 포인트). */
export const MESSAGE_MAX = 1000;
/** 대화방이 보이는 동안 새 메시지를 묻는 간격. */
export const POLL_MS = 5_000;

/** 기기에만 있는 말풍선 — 보내는 중이거나 보내지 못한 것. */
export type PendingMessage = { key: string; requestId: string; body: string; status: 'sending' | 'failed' };

/** 화면에 그릴 말풍선 한 줄. */
export type Bubble =
  | { kind: 'sent'; key: string; message: DirectMessage }
  | { kind: 'pending'; key: string; pending: PendingMessage };

/** 글·댓글 작성자 이름을 눌렀을 때 대화를 열 상대. 내 것이거나 작성자를 모르면(익명·옛 행) null — 아무 일도 하지 않는다. */
export function messageTarget(item: { author?: { id?: string | null } | null; is_mine?: boolean | null; mine?: boolean | null }): string | null {
  if (item.is_mine ?? item.mine ?? false) return null;
  return item.author?.id ?? null;
}

/**
 * 받은 메시지를 이미 가진 것과 합친다. id 가 같으면 하나만 두고, 오래된 것부터(시각 → id) 줄 세운다.
 * 폴링·더 보기·보내기 답이 겹쳐 와도 같은 말풍선이 두 번 생기지 않는다.
 */
export function mergeMessages(have: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const byId = new Map<string, DirectMessage>();
  for (const message of have) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const at = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (at !== 0 && !Number.isNaN(at)) return at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 대화방에 그릴 순서 — 보낸 메시지(오래된 것부터) 아래에 기기의 말풍선(보낸 순서). */
export function bubbles(messages: DirectMessage[], pending: PendingMessage[]): Bubble[] {
  return [
    ...messages.map((message) => ({ kind: 'sent' as const, key: message.id, message })),
    ...pending.map((item) => ({ kind: 'pending' as const, key: item.key, pending: item })),
  ];
}

/** 보낼 수 있는 본문인가 — 앞뒤 공백을 걷고 1~1000자. */
export function canSendBody(text: string): boolean {
  const body = text.trim();
  return body.length > 0 && [...body].length <= MESSAGE_MAX;
}

/** 보내지 못한 까닭. 차단·상대 탈퇴는 다시 보내도 같아 입력칸을 닫고, 그 밖은 말풍선에 「다시 보내기」를 단다. */
export type SendFailure = 'blocked' | 'partner_left' | 'daily_limit' | 'other';

export function sendFailure(error: unknown): SendFailure {
  const status = errorStatus(error);
  const code = errorCode(error);
  if (status === 403 && code === 'message_blocked') return 'blocked';
  if (status === 403 && code === 'partner_unavailable') return 'partner_left';
  if (status === 429 && code === 'daily_message_limit') return 'daily_limit';
  return 'other';
}

/** 대화를 열지 못한 까닭. */
export type StartFailure = 'blocked' | 'gone' | 'daily_limit' | 'member_only' | 'other';

export function startFailure(error: unknown): StartFailure {
  const status = errorStatus(error);
  const code = errorCode(error);
  if (status === 403 && code === 'message_blocked') return 'blocked';
  if (status === 403) return 'member_only';
  if (status === 404) return 'gone';
  if (status === 429) return 'daily_limit';
  return 'other';
}

/** 보낼 수 없는 대화방의 안내 문구 열쇠. 보낼 수 있으면 null. */
export function unavailableKey(conversation: Pick<DirectConversation, 'can_send' | 'unavailable_reason'>): string | null {
  if (conversation.can_send) return null;
  return conversation.unavailable_reason === 'partner_unavailable' ? 'messages.partnerLeft' : 'messages.blocked';
}

/** 목록 시각 — 「3분 전」(게시판과 같은 표기). 메시지가 없으면 빈 글. */
export function listTime(summary: Pick<DirectConversationSummary, 'last_message_at'>, now?: Date): string {
  return summary.last_message_at ? postedAtLabel(summary.last_message_at, now) : '';
}

/** 프로필 「메시지」 배지 — 99를 넘으면 99+, 0이면 달지 않는다. */
export function unreadBadge(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
