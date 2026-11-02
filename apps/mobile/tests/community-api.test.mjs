import assert from 'node:assert/strict';
import test from 'node:test';

import { api, id, jwtWithSubject, tokenStore } from './helpers/api-upload-task.mjs';

/**
 * 게시판 API(SOMA-873) — 서버 /v2/community 는 별도 PR 이 되살리므로 아직 spec/openapi.json 에 없다. 그래서 OpenAPI 대조(api-endpoints)
 * 대신 앱이 보내는 메서드·경로·본문을 여기서 잠근다. 서버 PR 이 이 모양(예전 80932a582^ 계약)을 따라야 한다.
 */
const USER = { id: id(91), email: 'actor@test.dev', status: 'active' };

test.before(async () => {
  assert.equal(await tokenStore.setTokens(jwtWithSubject(USER.id), 'refresh-1', USER), true);
});

function capture(t, body = {}, status = 200) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: (init.method ?? 'GET').toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null });
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  });
  return calls;
}

const P = id(1);
const C = id(2);
const CASES = [
  ['분류 목록', () => api.communityCategories(), { method: 'GET', path: '/v2/community/categories', body: null }],
  ['전체 글 목록', () => api.communityPosts(), { method: 'GET', path: '/v2/community/posts', body: null }],
  ['분류·커서 글 목록', () => api.communityPosts({ category: 'audition', cursor: 'abc' }), { method: 'GET', path: '/v2/community/posts?category=audition&cursor=abc', body: null }],
  ['글 상세', () => api.communityPost(P), { method: 'GET', path: `/v2/community/posts/${P}`, body: null }],
  ['글 올리기(사진 id 순서대로)', () => api.createCommunityPost({ category_slug: 'free', title: '제목', body: '내용', image_ids: [id(7), id(8)] }), { method: 'POST', path: '/v2/community/posts', body: { category_slug: 'free', title: '제목', body: '내용', image_ids: [id(7), id(8)] } }],
  ['글 고치기(제목·내용·사진)', () => api.updateCommunityPost(P, { title: '제목', body: '내용', image_ids: [] }), { method: 'PATCH', path: `/v2/community/posts/${P}`, body: { title: '제목', body: '내용', image_ids: [] } }],
  ['사진 올릴 주소', () => api.createCommunityImageIntent({ mime_type: 'image/jpeg', size_bytes: 1234 }), { method: 'POST', path: '/v2/community/images', body: { mime_type: 'image/jpeg', size_bytes: 1234 } }],
  ['사진 올리기 끝', () => api.completeCommunityImage(id(7)), { method: 'POST', path: `/v2/community/images/${id(7)}/complete`, body: null }],
  ['글 지우기', () => api.deleteCommunityPost(P), { method: 'DELETE', path: `/v2/community/posts/${P}`, body: null }],
  ['좋아요', () => api.likeCommunityPost(P, true), { method: 'POST', path: `/v2/community/posts/${P}/likes`, body: null }],
  ['좋아요 취소', () => api.likeCommunityPost(P, false), { method: 'DELETE', path: `/v2/community/posts/${P}/likes`, body: null }],
  ['댓글 목록', () => api.communityComments(P), { method: 'GET', path: `/v2/community/posts/${P}/comments`, body: null }],
  ['댓글 더 받기', () => api.communityComments(P, 'next'), { method: 'GET', path: `/v2/community/posts/${P}/comments?cursor=next`, body: null }],
  ['댓글 쓰기', () => api.createCommunityComment(P, { body: '댓글' }), { method: 'POST', path: `/v2/community/posts/${P}/comments`, body: { body: '댓글' } }],
  ['댓글 지우기', () => api.deleteCommunityComment(C), { method: 'DELETE', path: `/v2/community/comments/${C}`, body: null }],
  ['신고', () => api.reportCommunityContent({ target_type: 'comment', target_id: C, reason: 'abuse' }), { method: 'POST', path: '/v2/community/reports', body: { target_type: 'comment', target_id: C, reason: 'abuse' } }],
  ['차단', () => api.blockCommunityUser(id(3)), { method: 'POST', path: '/v2/community/blocks', body: { user_id: id(3) } }],
];

for (const [name, call, expected] of CASES) {
  test(`community api: ${name}`, async (t) => {
    const calls = capture(t, expected.method === 'DELETE' ? undefined : {}, expected.method === 'DELETE' ? 204 : 200);
    await call();
    assert.deepEqual(calls, [expected]);
  });
}

test('community api: 연락처 422 {"detail":"community_contact_info"} 는 사유 코드를 담은 오류다', async (t) => {
  capture(t, { detail: 'community_contact_info' }, 422);
  await assert.rejects(api.createCommunityPost({ category_slug: 'free', title: '연락 주세요', body: '010-0000-0000', image_ids: [] }), (e) => {
    assert.equal(e.status, 422);
    assert.equal(e.code, 'community_contact_info');
    assert.equal(e.detail, 'community_contact_info');
    return true;
  });
});

test('community api: 사진 수 초과 400 too_many_images', async (t) => {
  capture(t, { detail: 'too_many_images' }, 400);
  await assert.rejects(api.createCommunityPost({ category_slug: 'free', title: '제목', body: '내용', image_ids: [1, 2, 3, 4, 5, 6].map(id) }), (e) => {
    assert.equal(e.status, 400);
    assert.equal(e.code, 'too_many_images');
    return true;
  });
});

test('community api: 게스트 403 member_only', async (t) => {
  capture(t, { detail: 'member_only' }, 403);
  await assert.rejects(api.communityPosts(), (e) => e.status === 403 && e.code === 'member_only');
});
