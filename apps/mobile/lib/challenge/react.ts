import { translate } from '../i18n.ts';
import { COMMENT_MAX, type CreateCommentBody, type EntryComment } from './types.ts';

/**
 * 좋아요·저장·댓글(challenge.react).
 *
 * 반응은 개인 노출 조건을 만족하는 **다른 사람의** 참여작에만 된다 — 자기 것은 422 이고 비공개·
 * 삭제·숨김·차단 관계는 404 다. 좋아요는 앱이 먼저 바꿔 보이고 서버가 실패하면 서버 값으로
 * 되돌린다. 댓글은 공백 정리 뒤 1~500자이고 한 겹이며 본인만 지울 수 있다.
 */
export type LikeState = { liked: boolean; likeCount: number };

/** 누르는 순간의 표시. 서버 응답이 오면 그 값으로 맞춘다. */
export function optimisticLike(state: LikeState): LikeState {
  return state.liked
    ? { liked: false, likeCount: Math.max(0, state.likeCount - 1) }
    : { liked: true, likeCount: state.likeCount + 1 };
}

/** 서버가 실패했다 — 누르기 전 값으로 되돌린다. */
export function revertLike(before: LikeState): LikeState {
  return { ...before };
}

/** 자기 참여작에는 좋아요·저장을 할 수 없다. 버튼은 보이되 눌러도 보내지 않는다. */
export function canReact(entry: { is_mine?: boolean }): boolean {
  return !entry.is_mine;
}

export function optimisticSave(saved: boolean): boolean {
  return !saved;
}

// ─── 댓글 ─────────────────────────────────────────────────────────────────────

/** 공백을 정리한 본문. 비었으면 null 이라 보낼 수 없다. */
export function commentBody(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

export function commentTooLong(text: string): boolean {
  const body = commentBody(text);
  return body !== null && [...body].length > COMMENT_MAX;
}

export function canSendComment(text: string): boolean {
  return commentBody(text) !== null && !commentTooLong(text);
}

export function buildCommentBody(requestId: string, text: string): CreateCommentBody {
  return { request_id: requestId, body: commentBody(text) ?? '' };
}

export type CommentAttempt = { requestId: string; body: string };

/** 같은 댓글의 재전송은 같은 요청 id 다 — 행이 둘로 늘지 않는다. */
export function commentAttemptFor(
  previous: CommentAttempt | null,
  body: string,
  makeId: () => string,
): CommentAttempt {
  if (previous && previous.body === body) return previous;
  return { requestId: makeId(), body };
}

/** 작성자 이름 — 탈퇴했으면 "탈퇴한 사용자"다(이름 말고는 아무것도 보이지 않는다). */
export function commentAuthorName(comment: Pick<EntryComment, 'author' | 'author_withdrawn'>): string {
  return comment.author_withdrawn ? translate('comments.withdrawn') : comment.author.name;
}

/** 신고로 숨겨진 내 댓글은 원래 자리에 "확인 중"으로 보인다. 남의 숨겨진 댓글은 목록에 없다. */
export function commentText(comment: Pick<EntryComment, 'status' | 'body' | 'is_mine'>): string {
  if (comment.status === 'hidden') return translate('comments.underReview');
  return comment.body ?? '';
}

/** 본인 댓글만 지운다(남의 댓글 삭제는 404). 숨겨진 내 댓글도 지울 수 있다. */
export function canDeleteComment(comment: Pick<EntryComment, 'is_mine'>): boolean {
  return comment.is_mine;
}

export type ReactFailure =
  /** 비공개·삭제·숨김·차단 관계·없는 대상. */
  | { kind: 'not_found' }
  | { kind: 'self' }
  | { kind: 'daily_limit' }
  | { kind: 'too_long' }
  | { kind: 'member_only' }
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

export function reactFailure(error: unknown): ReactFailure {
  const code = codeOf(error);
  const status = statusOf(error);
  if (code === 'self_like' || code === 'self_save') return { kind: 'self' };
  if (code === 'daily_comment_limit' || status === 429) return { kind: 'daily_limit' };
  if (code === 'member_only' || status === 403) return { kind: 'member_only' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 422) return { kind: 'too_long' };
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  if (name === 'NetworkError' || status === null || (status >= 500 && status <= 599)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function reactFailureMessage(failure: ReactFailure): string {
  switch (failure.kind) {
    case 'not_found':
      return translate('react.gone');
    case 'self':
      return translate('react.selfNotAllowed');
    case 'daily_limit':
      return translate('react.dailyCommentLimit');
    case 'too_long':
      return translate('react.commentTooLong');
    case 'member_only':
      return translate('challenges.memberOnly');
    case 'offline':
      return translate('challenges.offline');
    default:
      return translate('react.failed');
  }
}
