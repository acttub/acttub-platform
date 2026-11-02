/**
 * 배우 게시판(SOMA-873) — 서버 모양과 화면 규칙.
 *
 * 서버는 예전 `/v2/community` 계약(80932a582 이전)을 되살리고 칸 몇 개를 더한다: 글·댓글의 `author_name`(없으면 null),
 * `is_mine`, 글의 `status`(visible|hidden — 신고로 가려진 글은 쓴 사람에게만 보인다), 연락처가 든 글의 422
 * `{"detail":"community_contact_info"}`, 사진 `images: [{id, url}]`(0~5장). 서버는 `mine`·`is_mine` 을 둘 다 준다.
 * 회원 전용이라 게스트는 403 `member_only`, 탈퇴 계정은 403 `account_deactivated` 다.
 *
 * 화면이 쓰는 값은 여기서 한 번에 고른다 — 이름·내 글 여부·작성자 id·미리보기·상대 시각·새 글 점·글쓰기 검사.
 */

import { classifyUnprocessable, errorCode, errorStatus } from './api-request.ts';
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

/** 글에 붙은 사진. 목록 글은 최소 첫 장, 상세 글은 전부(순서대로). */
export type CommunityImage = { id: string; url: string };

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
  images?: CommunityImage[] | null;
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

/** 글 만들기. `image_ids` 는 올려 둔 사진 id 0~5개, 보이는 순서대로. */
export type PostWriteBody = { category_slug: string; title: string; body: string; image_ids: string[] };
/** 글 고치기 — 제목·내용·사진(남길 것 + 새로 올린 것, 순서대로)을 통째로 보낸다. 분류는 그대로다. */
export type PostUpdateBody = { title: string; body: string; image_ids: string[] };

/** 사진 올릴 주소(POST /v2/community/images). `upload_headers` 를 그대로 붙여 PUT 한다. */
export type CommunityImageIntent = {
  image_id: string;
  upload_url: string;
  upload_headers?: Record<string, string> | null;
  expires_at: string;
};

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
export const MAX_IMAGES = 5;

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

/** 목록 행 썸네일 — 첫 사진과 장수. 사진이 없으면 null. */
export function listThumb(post: Pick<CommunityPost, 'images'>): { url: string; count: number } | null {
  const images = post.images ?? [];
  return images[0] ? { url: images[0].url, count: images.length } : null;
}

/**
 * 글 올리기·고치기 실패. 연락처(422 `{"detail":"community_contact_info"}` — 다른 422 사유와 같이 detail 글자로 온다)는
 * 내용 칸에, 사진 수·사진 오류(400 too_many_images · invalid_image)와 그 밖은 버튼 위에 알린다.
 */
export type PostWriteFailure = 'contact' | 'too_many_images' | 'invalid_image' | 'member_only' | 'other';

export function postWriteFailure(error: unknown): PostWriteFailure {
  const unprocessable = classifyUnprocessable(error);
  if (unprocessable?.kind === 'reason' && unprocessable.code === 'community_contact_info') return 'contact';
  const code = errorCode(error);
  if (errorStatus(error) === 400 && code === 'too_many_images') return 'too_many_images';
  if (errorStatus(error) === 400 && code === 'invalid_image') return 'invalid_image';
  if (errorStatus(error) === 403 && code !== 'account_deactivated') return 'member_only';
  return 'other';
}

/**
 * 게시판을 읽지 못한 까닭 — 회원 전용(게스트 403 member_only)과 탈퇴 계정(403 account_deactivated)은 다시 시도해도 같아
 * 챌린지 목록처럼 한 줄로만 알리고, 그 밖은 「다시 시도」를 단다.
 */
export type BoardFailure = 'member_only' | 'deactivated' | 'other';

export function boardFailure(error: unknown): BoardFailure {
  if (errorStatus(error) !== 403) return 'other';
  return errorCode(error) === 'account_deactivated' ? 'deactivated' : 'member_only';
}

/** 실패 까닭의 문장. */
export function boardFailureMessage(failure: BoardFailure): string {
  if (failure === 'member_only') return translate('community.memberOnly');
  if (failure === 'deactivated') return translate('errors.withdrawn');
  return translate('community.loadFail');
}

// ─── 글쓰기 사진 ────────────────────────────────────────────────────────────────

/** 글쓰기 화면의 사진 한 장. 고른 사진은 바로 올리기 시작하고, 고치는 글의 기존 사진은 처음부터 `done` 이다. */
export type DraftImage = {
  /** 화면 안에서만 쓰는 열쇠. */
  key: string;
  /** 썸네일로 보일 주소 — 기기 파일(고른 사진) 또는 서버 주소(기존 사진). */
  uri: string;
  /** 서버 사진 id. 올리기가 끝나야 생긴다. */
  imageId: string | null;
  status: 'uploading' | 'done' | 'failed';
};

/** 지금 몇 장 더 고를 수 있나. */
export function remainingSlots(drafts: DraftImage[]): number {
  return Math.max(0, MAX_IMAGES - drafts.length);
}

/** 한 번에 여러 장 골랐을 때 남은 자리만큼 앞에서부터 자른다. */
export function takeAllowed<T>(picked: T[], drafts: DraftImage[]): T[] {
  return picked.slice(0, remainingSlots(drafts));
}

/** 글에 실어 보낼 사진 id — 보이는 순서대로, 다 올라간 것만. */
export function imageIdsOf(drafts: DraftImage[]): string[] {
  return drafts.filter((d) => d.status === 'done' && d.imageId).map((d) => d.imageId as string);
}

/** 사진 상태 요약 — 올리는 중이면 「올리기」를 끄고 「사진 올리는 중…」, 실패한 사진이 있으면 끄고 다시 시도·빼기를 기다린다. */
export function imagesState(drafts: DraftImage[]): 'ready' | 'uploading' | 'failed' {
  if (drafts.some((d) => d.status === 'uploading')) return 'uploading';
  if (drafts.some((d) => d.status === 'failed')) return 'failed';
  return 'ready';
}

/** 고치는 글의 기존 사진을 글쓰기 사진 줄로 옮긴다. */
export function draftsFromPost(post: Pick<CommunityPost, 'images'>): DraftImage[] {
  return (post.images ?? []).map((image) => ({ key: `server-${image.id}`, uri: image.url, imageId: image.id, status: 'done' as const }));
}
