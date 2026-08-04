/**
 * 게시판 타입과 표시 규칙.
 *
 * 익명 글은 서버가 글 단위 번호(익명1·익명2)를 `author.alias`로 내려준다.
 * 앱에서 세지 않는다 — 댓글이 커서로 나뉘어 오면 페이지마다 번호가 달라진다.
 */

export type CommunityAuthor = {
  id?: string | null;
  nickname?: string | null;
  alias?: string | null;
};

export type CommunityPost = {
  id: string;
  anonymous: boolean;
  category_slug: string;
  category_name: string;
  author: CommunityAuthor;
  title: string;
  body: string;
  like_count: number;
  comment_count: number;
  view_count: number;
  liked_by_me: boolean;
  mine: boolean;
  created_at: string;
  updated_at?: string | null;
};

export type CommunityComment = {
  id: string;
  post_id: string;
  anonymous: boolean;
  author: CommunityAuthor;
  body: string;
  mine: boolean;
  created_at: string;
  updated_at?: string | null;
};

export type CommunityCategory = {
  slug: string;
  name: string;
  description?: string | null;
};

export type PostListResponse = { posts: CommunityPost[]; next_cursor?: string | null };
export type CommentListResponse = { comments: CommunityComment[]; next_cursor?: string | null };

/**
 * 화면에 쓸 작성자 이름.
 * 익명이면 서버가 준 alias를 그대로 쓰고, 없으면 '익명'으로 떨어뜨린다.
 */
export function authorName(author: CommunityAuthor, anonymous: boolean): string {
  if (anonymous) return author.alias?.trim() || '익명';
  return author.nickname?.trim() || '배우';
}

/** 목록 카드에 넣을 본문 한 줄. 줄바꿈을 공백으로 눕히고 길면 자른다. */
export function bodyPreview(body: string, limit = 80): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * "3분 전" 같은 상대 시각. `now`가 없으면 빈 문자열 — 서버·클라이언트 시각이
 * 어긋나 화면이 흔들리는 걸 막으려고 렌더 후에만 채운다.
 */
export function relativeTime(iso: string, now: number | null): string {
  if (now === null) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const diff = Math.max(0, now - at);
  const minute = 60_000;
  if (diff < minute) return '방금';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}분 전`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))}시간 전`;
  const days = Math.floor(diff / (24 * 60 * minute));
  if (days < 7) return `${days}일 전`;
  return new Date(at).toISOString().slice(0, 10);
}

/** 카테고리 칩에 쓸 목록. 맨 앞에 '전체'를 끼운다. */
export const ALL_CATEGORY = { slug: '', name: '전체' } as const;

export function categoryChips(categories: CommunityCategory[]) {
  return [ALL_CATEGORY, ...categories.map((c) => ({ slug: c.slug, name: c.name }))];
}
