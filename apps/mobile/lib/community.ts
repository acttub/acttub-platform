/**
 * 배우 게시판(SOMA-873) — 서버 모양과 화면 규칙.
 *
 * 서버는 예전 `/v2/community` 계약(80932a582 이전)을 되살리고 칸 몇 개를 더한다: 글·댓글의 `author_name`(없으면 null),
 * `is_mine`, 글의 `status`(신고로 가려진 글은 "hidden" 이고 쓴 사람에게만 보인다), 연락처가 든 글의 422
 * `community_contact_info`. 되살린 첫 판은 `mine`·`author.nickname` 만 줄 수 있어 둘 다 읽는다.
 *
 * 화면이 쓰는 값은 여기서 한 번에 고른다 — 이름·내 글 여부·작성자 id·미리보기·상대 시각·새 글 점·글쓰기 검사.
 */

import { errorCode, errorStatus } from './api-request.ts';
import { translate } from './i18n.ts';
import { postedAtLabel } from './time-label.ts';

export type CommunityAuthor = {
  id?: string | null;
  nickname?: string | null;
  alias?: string | null;
};

type Authored = {
  author_name?: string | null;
  author?: CommunityAuthor | null;
  is_mine?: boolean | null;
  mine?: boolean | null;
};

export type CommunityPost = Authored & {
  id: string;
  category_slug: string;
  category_name: string;
  title: string;
  body: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  /** 보통 "visible". 신고가 쌓여 가려지면 "hidden" — 쓴 사람만 받는다. */
  status?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type CommunityComment = Authored & {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  updated_at?: string | null;
};

export type CommunityCategory = { slug: string; name: string; description?: string | null };

export type CategoryListResponse = { categories: CommunityCategory[] };
export type PostListResponse = { posts: CommunityPost[]; next_cursor?: string | null };
export type CommentListResponse = { comments: CommunityComment[]; next_cursor?: string | null };
export type LikeResponse = { like_count: number; liked_by_me: boolean };

export type PostWriteBody = { category_slug: string; title: string; body: string };
export type PostUpdateBody = { title: string; body: string };

/** 서버 신고 사유(예전 ReportRequest.reason). 순서가 화면 순서다. */
export const COMMUNITY_REPORT_REASONS = ['spam', 'abuse', 'sexual', 'privacy', 'other'] as const;
export type CommunityReportReason = (typeof COMMUNITY_REPORT_REASONS)[number];
export type CommunityReportBody = {
  target_type: 'post' | 'comment';
  target_id: string;
  reason: CommunityReportReason;
  detail?: string;
};

export const TITLE_MAX = 100;
export const BODY_MAX = 2000;
export const COMMENT_MAX = 1000;
export const REPORT_DETAIL_MAX = 500;

/** 화면에 쓸 이름 — 서버가 준 `author_name`, 없으면 「배우」. */
export function displayName(item: Authored): string {
  return item.author_name?.trim() || item.author?.nickname?.trim() || translate('community.actorFallback');
}

/** 내 글·댓글인가. */
export function isMine(item: Authored): boolean {
  return item.is_mine ?? item.mine ?? false;
}

/** 차단·기본 얼굴 색에 쓰는 작성자 id. 내 것이거나 서버가 주지 않으면 null. */
export function authorId(item: Authored): string | null {
  return item.author?.id ?? null;
}

/** 기본 얼굴 색을 정할 씨앗 — 작성자 id, 없으면 이름. 같은 사람은 글·댓글 어디서나 같은 색이다. */
export function avatarSeed(item: Authored): string {
  return authorId(item) ?? displayName(item);
}

/** 신고로 가려져 나만 보는 글인가. */
export function isHiddenPost(post: Pick<CommunityPost, 'status'>): boolean {
  return post.status === 'hidden';
}

/** 댓글 단 사람이 글쓴이인가 — 「글쓴이」 배지. 작성자 id 가 없으면 내 글에 내가 단 댓글만 안다. */
export function isPostAuthor(post: CommunityPost, comment: CommunityComment): boolean {
  const postAuthor = authorId(post);
  const commentAuthor = authorId(comment);
  if (postAuthor && commentAuthor) return postAuthor === commentAuthor;
  return isMine(post) && isMine(comment);
}

/** 목록 한 줄 미리보기 — 줄바꿈을 공백으로 눕힌다. 자르기는 화면의 한 줄 말줄임이 한다. */
export function bodyPreview(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/** "3분 전" — 챌린지 참여작과 같은 표기(lib/time-label). */
export function relativeTime(iso: string, now?: Date): string {
  return postedAtLabel(iso, now);
}

/** 목록 메타 한 줄: `이름 · 3분 전`. */
export function metaLine(item: Authored & { created_at: string }, now?: Date): string {
  const time = relativeTime(item.created_at, now);
  return time ? `${displayName(item)} · ${time}` : displayName(item);
}

/** 분류 칩 — 맨 앞에 「전체」(빈 slug). 서버가 준 분류를 그대로 그린다. */
export function categoryChips(categories: CommunityCategory[]): { slug: string; name: string }[] {
  return [{ slug: '', name: translate('community.all') }, ...categories.map((c) => ({ slug: c.slug, name: c.name }))];
}

/** 게시판에 마지막으로 본 뒤 새 글이 있는가 — 가장 최근 글 시각과 기기에 적어 둔 본 시각을 비교한다. */
export function hasNewSince(latestCreatedAt: string | null | undefined, seenAt: string | null | undefined): boolean {
  if (!latestCreatedAt) return false;
  const latest = Date.parse(latestCreatedAt);
  if (Number.isNaN(latest)) return false;
  if (!seenAt) return true;
  const seen = Date.parse(seenAt);
  return Number.isNaN(seen) || latest > seen;
}

/** 글자 수 — 이모지·한글 조합도 사람이 보는 글자 하나로 센다. */
export function charCount(text: string): number {
  return [...text].length;
}

/** 「올리기」를 켤 수 있는가 — 분류·제목·내용이 다 있고 길이 안이다. */
export function canSubmitPost(input: { category: string | null; title: string; body: string }): boolean {
  const title = input.title.trim();
  const body = input.body.trim();
  return (
    !!input.category &&
    title.length > 0 &&
    body.length > 0 &&
    charCount(title) <= TITLE_MAX &&
    charCount(body) <= BODY_MAX
  );
}

/** `1,234 / 2,000` 글자 수 표시. */
export function bodyCounter(body: string): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  return `${fmt(charCount(body))} / ${fmt(BODY_MAX)}`;
}

/** 글 올리기·고치기 실패 — 연락처가 들어간 글(422 community_contact_info)만 따로 알린다. */
export type PostWriteFailure = 'contact' | 'other';

export function postWriteFailure(error: unknown): PostWriteFailure {
  return errorStatus(error) === 422 && errorCode(error) === 'community_contact_info' ? 'contact' : 'other';
}
