import type { CommunityPost } from './community.ts';

/**
 * 목록에서 누른 글을 상세 화면이 바로 그리게 잠깐 들고 있는다(11/2 폰 QA: 게시판 글 들어가는 게 느림).
 * 상세는 이 값을 먼저 그리고, 서버에서 글·댓글을 받아 바꾼다.
 */
const seeds = new Map<string, CommunityPost>();
const MAX_SEEDS = 50;

export function seedCommunityPost(post: CommunityPost): void {
  seeds.delete(post.id);
  seeds.set(post.id, post);
  if (seeds.size > MAX_SEEDS) {
    const oldest = seeds.keys().next().value;
    if (oldest !== undefined) seeds.delete(oldest);
  }
}

export function communityPostSeed(id: string | null | undefined): CommunityPost | null {
  return id ? (seeds.get(id) ?? null) : null;
}
