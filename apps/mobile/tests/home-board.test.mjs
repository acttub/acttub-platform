import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HOME_BOARD_PAGE, latestByCategory, popularPosts } from '../lib/home-board.ts';

const NOW = new Date('2026-11-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const post = (id, over = {}) => ({ id, category_slug: 'free', created_at: ago(1), like_count: 0, comment_count: 0, ...over });

test('latestByCategory: 자유·질문·홍보 순서로 칸마다 가장 최근 글 하나, 글 없는 칸은 뺀다', () => {
  const posts = [
    post('q-old', { category_slug: 'question', created_at: ago(5) }),
    post('f-new', { category_slug: 'free', created_at: ago(1) }),
    post('q-new', { category_slug: 'question', created_at: ago(2) }),
    post('f-old', { category_slug: 'free', created_at: ago(3) }),
    post('a', { category_slug: 'audition', created_at: ago(0) }),
  ];
  assert.deepEqual(latestByCategory(posts).map((p) => p.id), ['f-new', 'q-new']);
  assert.deepEqual(latestByCategory([]), []);
});

test('popularPosts: 최근 14일 안에서 좋아요+댓글 합이 큰 순으로 둘, 같으면 더 최근', () => {
  const posts = [
    post('a', { like_count: 1, comment_count: 1, created_at: ago(1) }), // 2
    post('b', { like_count: 5, comment_count: 0, created_at: ago(3) }), // 5
    post('c', { like_count: 0, comment_count: 2, created_at: ago(0.5) }), // 2, 더 최근
    post('old', { like_count: 50, comment_count: 50, created_at: ago(15) }), // 14일 밖
  ];
  assert.deepEqual(popularPosts(posts, NOW).map((p) => p.id), ['b', 'c']);
  // 14일 경계 안쪽은 넣는다.
  assert.deepEqual(popularPosts([post('edge', { like_count: 1, created_at: ago(14) })], NOW).map((p) => p.id), ['edge']);
});

test('popularPosts: 좋아요·댓글이 하나도 없는 글뿐이면 비어 있다(구역째 숨김)', () => {
  assert.deepEqual(popularPosts([post('a'), post('b')], NOW), []);
  assert.deepEqual(popularPosts([post('bad', { like_count: 3, created_at: 'nope' })], NOW), []);
});

test('홈은 게시판 첫 쪽을 한 번만 받고 두 구역이 같이 쓴다', () => {
  assert.equal(HOME_BOARD_PAGE, 30);
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.equal(home.match(/api\.communityPosts\(/g)?.length, 1);
  assert.match(home, /api\.communityPosts\(\{ limit: HOME_BOARD_PAGE \}\)/);
});
