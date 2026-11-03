import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import {
  BODY_MAX,
  COMMUNITY_REPORT_REASONS,
  authorId,
  avatarSeed,
  MAX_IMAGES,
  boardFailure,
  bodyCounter,
  bodyPreview,
  canSubmitPost,
  categoryChips,
  displayName,
  draftsFromPost,
  hasNewSince,
  imageIdsOf,
  imagesState,
  isHiddenPost,
  isMine,
  isPostAuthor,
  listThumb,
  metaLine,
  postWriteFailure,
  remainingSlots,
  takeAllowed,
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

// 서버는 연락처를 422 {"detail":"community_contact_info"} 로 준다 — 다른 422 사유와 같이 detail 글자다.
const apiError = (status, detail) => new ApiError(status, 'x', typeof detail === 'string' ? detail : 'validation_error', detail);

test('422 detail community_contact_info 만 연락처 실패로 본다', () => {
  assert.equal(postWriteFailure(apiError(422, 'community_contact_info')), 'contact');
  assert.equal(postWriteFailure(apiError(422, [{ loc: ['body', 'title'] }])), 'other');
  assert.equal(postWriteFailure(apiError(422, 'validation')), 'other');
  assert.equal(postWriteFailure(new Error('offline')), 'other');
});

test('사진 수·사진 오류(400)와 회원 전용(403)을 가른다', () => {
  assert.equal(postWriteFailure(apiError(400, 'too_many_images')), 'too_many_images');
  assert.equal(postWriteFailure(apiError(400, 'invalid_image')), 'invalid_image');
  assert.equal(postWriteFailure(apiError(403, 'member_only')), 'member_only');
  assert.equal(postWriteFailure(apiError(403, 'account_deactivated')), 'other');
});

test('게시판을 못 읽은 까닭 — 게스트는 회원 전용, 탈퇴 계정은 따로, 그 밖은 다시 시도', () => {
  assert.equal(boardFailure(apiError(403, 'member_only')), 'member_only');
  assert.equal(boardFailure(apiError(403, 'account_deactivated')), 'deactivated');
  assert.equal(boardFailure(apiError(500, 'boom')), 'other');
  assert.equal(boardFailure(new Error('offline')), 'other');
});

test('목록 썸네일은 첫 사진과 장수다', () => {
  assert.equal(listThumb({ images: [] }), null);
  assert.equal(listThumb({}), null);
  assert.deepEqual(listThumb({ images: [{ id: 'i1', url: 'u1' }, { id: 'i2', url: 'u2' }] }), { url: 'u1', count: 2 });
});

const draft = (n, status = 'done') => ({ key: `k${n}`, uri: `file:///p${n}.jpg`, imageId: status === 'done' ? `img${n}` : null, status });

test('사진은 5장까지 — 여러 장 고르면 남은 자리만큼 앞에서 자른다', () => {
  assert.equal(MAX_IMAGES, 5);
  assert.equal(remainingSlots([]), 5);
  assert.equal(remainingSlots([draft(1), draft(2)]), 3);
  assert.deepEqual(takeAllowed(['a', 'b', 'c', 'd', 'e', 'f', 'g'], []), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(takeAllowed(['a', 'b', 'c'], [draft(1), draft(2), draft(3), draft(4)]), ['a']);
  assert.deepEqual(takeAllowed(['a'], [1, 2, 3, 4, 5].map((n) => draft(n))), []);
});

test('글에 싣는 사진 id 는 보이는 순서대로, 다 올라간 것만', () => {
  assert.deepEqual(imageIdsOf([draft(2), draft(9, 'uploading'), draft(1), draft(3, 'failed')]), ['img2', 'img1']);
});

test('올리는 중이 하나라도 있으면 uploading, 실패가 있으면 failed', () => {
  assert.equal(imagesState([]), 'ready');
  assert.equal(imagesState([draft(1), draft(2, 'failed'), draft(3, 'uploading')]), 'uploading');
  assert.equal(imagesState([draft(1), draft(2, 'failed')]), 'failed');
  assert.equal(imagesState([draft(1)]), 'ready');
});

test('고치는 글의 기존 사진은 다 올라간 사진으로 줄에 들어온다', () => {
  assert.deepEqual(draftsFromPost({ images: [{ id: 'i1', url: 'https://cdn/1.jpg' }] }), [
    { key: 'server-i1', uri: 'https://cdn/1.jpg', imageId: 'i1', status: 'done' },
  ]);
  assert.deepEqual(draftsFromPost({}), []);
});

test('신고 사유는 게시판 서버 계약 다섯 가지다', () => {
  assert.deepEqual([...COMMUNITY_REPORT_REASONS], ['spam', 'abuse', 'sexual', 'privacy', 'other']);
});

// 11/2 폰 QA — 영어 앱에서 분류 칩·글 분류가 서버 이름(한국어)으로 나왔다. 아는 분류는 앱 언어로 그린다.
test('아는 분류는 앱 언어 이름, 모르는 분류는 서버 이름', async () => {
  const { categoryLabel, categoryChips, fallbackCategories } = await import('../lib/community.ts');
  assert.equal(categoryLabel('partner', 'partner-from-server'), '상대역 구함');
  assert.equal(categoryLabel('new_kind', '새 분류'), '새 분류');
  assert.equal(categoryLabel(null, null), '');
  assert.deepEqual(categoryChips([{ slug: 'free', name: 'x' }]).map((c) => c.name), ['전체', '자유']);
  // 분류 목록을 못 받았을 때도 칩이 「전체」 하나만 남지 않는다.
  assert.deepEqual(fallbackCategories().map((c) => c.slug), ['free', 'question', 'promo']);
});
