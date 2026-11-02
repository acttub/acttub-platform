import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import {
  BODY_MAX,
  COMMUNITY_REPORT_REASONS,
  authorId,
  avatarSeed,
  bodyCounter,
  bodyPreview,
  canSubmitPost,
  categoryChips,
  displayName,
  hasNewSince,
  isHiddenPost,
  isMine,
  isPostAuthor,
  metaLine,
  postWriteFailure,
} from '../lib/community.ts';

/**
 * 배우 게시판(SOMA-873) 화면 규칙. 서버는 예전 /v2/community 계약에 author_name·is_mine·status 를 더하고,
 * 연락처가 든 글은 422 community_contact_info 로 막는다.
 */

test('이름은 author_name, 없으면 배우로 보여준다', () => {
  assert.equal(displayName({ author_name: '하늘' }), '하늘');
  assert.equal(displayName({ author_name: '  ' }), '배우');
  assert.equal(displayName({ author_name: null }), '배우');
  assert.equal(displayName({}), '배우');
  // 되살린 첫 판 서버가 author.nickname 만 줘도 이름이 빠지지 않는다.
  assert.equal(displayName({ author_name: null, author: { nickname: '달빛' } }), '달빛');
});

test('내 글 여부는 is_mine, 없으면 예전 mine 을 본다', () => {
  assert.equal(isMine({ is_mine: true }), true);
  assert.equal(isMine({ is_mine: false, mine: true }), false);
  assert.equal(isMine({ mine: true }), true);
  assert.equal(isMine({}), false);
});

test('기본 얼굴 색은 작성자 id 로, 없으면 이름으로 정한다', () => {
  assert.equal(authorId({ author: { id: 'u1' } }), 'u1');
  assert.equal(authorId({ author: null }), null);
  assert.equal(avatarSeed({ author: { id: 'u1' }, author_name: '하늘' }), 'u1');
  assert.equal(avatarSeed({ author_name: '하늘' }), '하늘');
});

test('신고로 가려진 글은 status hidden 이다', () => {
  assert.equal(isHiddenPost({ status: 'hidden' }), true);
  assert.equal(isHiddenPost({ status: 'visible' }), false);
  assert.equal(isHiddenPost({}), false);
});

const post = (over = {}) => ({
  id: 'p1',
  category_slug: 'question',
  category_name: '질문',
  title: '독백 2분 넘으면 감점인가요?',
  body: '본문',
  like_count: 0,
  comment_count: 0,
  liked_by_me: false,
  created_at: '2026-11-02T00:00:00Z',
  ...over,
});
const comment = (over = {}) => ({ id: 'c1', post_id: 'p1', body: '댓글', created_at: '2026-11-02T00:00:00Z', ...over });

test('글쓴이 배지는 같은 작성자 id 일 때, id 가 없으면 내 글에 내가 단 댓글일 때 붙는다', () => {
  assert.equal(isPostAuthor(post({ author: { id: 'u1' } }), comment({ author: { id: 'u1' } })), true);
  assert.equal(isPostAuthor(post({ author: { id: 'u1' } }), comment({ author: { id: 'u2' } })), false);
  assert.equal(isPostAuthor(post({ is_mine: true }), comment({ is_mine: true })), true);
  assert.equal(isPostAuthor(post({ is_mine: false }), comment({ is_mine: true })), false);
});

test('미리보기는 줄바꿈을 눕힌다', () => {
  assert.equal(bodyPreview('첫 줄\n\n둘째 줄  '), '첫 줄 둘째 줄');
});

test('목록 메타는 이름 · 상대 시각이다', () => {
  const now = new Date('2026-11-02T00:12:00Z');
  assert.equal(metaLine({ author_name: '하늘', created_at: '2026-11-02T00:00:00Z' }, now), '하늘 · 12분 전');
  assert.equal(metaLine({ author_name: null, created_at: 'bad' }, now), '배우');
});

test('분류 칩 맨 앞에는 전체가 오고 서버 분류를 그대로 잇는다', () => {
  const chips = categoryChips([
    { slug: 'question', name: '질문' },
    { slug: 'audition', name: '오디션 정보' },
  ]);
  assert.deepEqual(chips, [
    { slug: '', name: '전체' },
    { slug: 'question', name: '질문' },
    { slug: 'audition', name: '오디션 정보' },
  ]);
});

test('새 글 점은 최신 글이 마지막으로 본 시각보다 늦을 때만 켠다', () => {
  assert.equal(hasNewSince(null, null), false);
  assert.equal(hasNewSince('2026-11-02T01:00:00Z', null), true);
  assert.equal(hasNewSince('2026-11-02T01:00:00Z', '2026-11-02T01:00:00Z'), false);
  assert.equal(hasNewSince('2026-11-02T01:00:01Z', '2026-11-02T01:00:00Z'), true);
  assert.equal(hasNewSince('bad', null), false);
});

test('올리기는 분류·제목·내용이 다 있고 길이 안일 때만 켠다', () => {
  assert.equal(canSubmitPost({ category: null, title: '제목', body: '내용' }), false);
  assert.equal(canSubmitPost({ category: 'free', title: ' ', body: '내용' }), false);
  assert.equal(canSubmitPost({ category: 'free', title: '제목', body: '' }), false);
  assert.equal(canSubmitPost({ category: 'free', title: '제목', body: '내용' }), true);
  assert.equal(canSubmitPost({ category: 'free', title: '제목', body: '가'.repeat(BODY_MAX + 1) }), false);
});

test('글자 수는 n / 2,000 으로 보인다', () => {
  assert.equal(bodyCounter(''), '0 / 2,000');
  assert.equal(bodyCounter('가'.repeat(1234)), '1,234 / 2,000');
});

test('422 community_contact_info 만 연락처 실패로 본다', () => {
  assert.equal(postWriteFailure(new ApiError(422, 'x', 'community_contact_info')), 'contact');
  assert.equal(postWriteFailure(new ApiError(422, 'x', 'validation')), 'other');
  assert.equal(postWriteFailure(new Error('offline')), 'other');
});

test('신고 사유는 게시판 서버 계약 다섯 가지다', () => {
  assert.deepEqual([...COMMUNITY_REPORT_REASONS], ['spam', 'abuse', 'sexual', 'privacy', 'other']);
});
