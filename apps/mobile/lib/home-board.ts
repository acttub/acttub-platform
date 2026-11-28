/**
 * 홈 「게시판」·「인기 글」 구역이 쓸 글을 고른다. 서버에 인기순 API가 없어 게시판 첫 쪽(최신순) 한 번을 받아 여기서 고른다.
 * 두 구역이 같은 응답을 쓴다 — 요청은 한 번이다.
 */
import type { CommunityPost } from './community.ts';

/** 홈이 한 번에 받는 글 수. 서버 기본 쪽 크기는 20, 최대 50이다. */
export const HOME_BOARD_PAGE = 30;

/** 홈 「게시판」에 줄을 두는 칸 — 글쓰기에 쓰는 칸과 같다(자유·질문·홍보). */
export const HOME_BOARD_CATEGORIES = ['free', 'question', 'promo'] as const;

/** 인기 글로 볼 기간 — 최근 14일. */
export const POPULAR_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const POPULAR_COUNT = 2;

function timeOf(post: Pick<CommunityPost, 'created_at'>): number {
  const at = Date.parse(post.created_at);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/** 칸마다 가장 최근 글 하나 — 칸 순서대로, 글이 없는 칸은 뺀다. */
export function latestByCategory<P extends Pick<CommunityPost, 'category_slug' | 'created_at'>>(
  posts: readonly P[],
  categories: readonly string[] = HOME_BOARD_CATEGORIES,
): P[] {
  return categories.flatMap((slug) => {
    let best: P | null = null;
    for (const post of posts) {
      if (post.category_slug !== slug) continue;
      if (!best || timeOf(post) > timeOf(best)) best = post;
    }
    return best ? [best] : [];
  });
}

/**
 * 인기 글 — 최근 14일 글 중 좋아요+댓글 합이 큰 순(같으면 더 최근)으로 둘. 합이 0인 글은 넣지 않는다.
 * 그런 글뿐이면 빈 배열이고, 화면은 구역째 숨긴다.
 */
export function popularPosts<P extends Pick<CommunityPost, 'created_at' | 'like_count' | 'comment_count'>>(
  posts: readonly P[],
  now: Date = new Date(),
  count: number = POPULAR_COUNT,
): P[] {
  const since = now.getTime() - POPULAR_WINDOW_MS;
  const score = (p: P) => (p.like_count ?? 0) + (p.comment_count ?? 0);
  return posts
    .filter((p) => timeOf(p) >= since && score(p) > 0)
    .sort((a, b) => score(b) - score(a) || timeOf(b) - timeOf(a))
    .slice(0, count);
}
