import assert from 'node:assert/strict';
import test from 'node:test';

import { api, id, jwtWithSubject, tokenStore } from './helpers/api-upload-task.mjs';

/** 1:1 메시지 API(SOMA-1039) — 앱이 보내는 메서드·경로·본문을 잠근다(서버 계약은 docs/specs/community/messages.md). */
const USER = { id: id(92), email: 'actor@test.dev', status: 'active' };

test.before(async () => {
  assert.equal(await tokenStore.setTokens(jwtWithSubject(USER.id), 'refresh-1', USER), true);
});

function capture(t, body = {}, status = 200) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    calls.push({
      method: (init.method ?? 'GET').toUpperCase(),
      path: u.pathname + u.search,
      body: init.body ? JSON.parse(init.body) : null,
      requestId: headers.get('X-Request-Id'),
    });
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  });
  return calls;
}

const C = id(5);
const R = id(6);
const CASES = [
  ['대화 열기(글에서)', () => api.startDirectConversation({ user_id: id(3), post_id: id(4) }), { method: 'POST', path: '/v2/messages/conversations', body: { user_id: id(3), post_id: id(4) } }],
  ['대화 목록', () => api.listConversations(), { method: 'GET', path: '/v2/messages/conversations', body: null }],
  ['대화 목록 더 받기', () => api.listConversations('next'), { method: 'GET', path: '/v2/messages/conversations?cursor=next', body: null }],
  ['대화방 머리', () => api.conversation(C), { method: 'GET', path: `/v2/messages/conversations/${C}`, body: null }],
  ['메시지 목록', () => api.listMessages(C), { method: 'GET', path: `/v2/messages/conversations/${C}/messages`, body: null }],
  ['옛 메시지', () => api.listMessages(C, 'older'), { method: 'GET', path: `/v2/messages/conversations/${C}/messages?cursor=older`, body: null }],
  ['읽음', () => api.markConversationRead(C), { method: 'POST', path: `/v2/messages/conversations/${C}/read`, body: null }],
  ['신고', () => api.reportConversation(C, { reason: 'abuse' }), { method: 'POST', path: `/v2/messages/conversations/${C}/reports`, body: { reason: 'abuse' } }],
  ['안 읽은 수', () => api.unreadMessageCount(), { method: 'GET', path: '/v2/messages/unread-count', body: null }],
];

for (const [name, call, expected] of CASES) {
  test(`messages api: ${name}`, async (t) => {
    const calls = capture(t, expected.path.endsWith('/read') || expected.path.endsWith('/reports') ? undefined : {}, expected.path.endsWith('/read') || expected.path.endsWith('/reports') ? 204 : 200);
    await call();
    assert.equal(calls.length, 1);
    const { requestId: _ignored, ...rest } = calls[0];
    assert.deepEqual(rest, expected);
  });
}

test('messages api: 보내기는 본문의 request_id 를 X-Request-Id 로도 싣는다', async (t) => {
  const calls = capture(t, { id: id(7), conversation_id: C, body: '안녕', mine: true, created_at: '2026-11-28T00:00:00Z' }, 201);
  await api.sendMessage(C, { request_id: R, body: '안녕' });
  assert.equal(calls.length, 1);
  assert.deepEqual({ method: calls[0].method, path: calls[0].path, body: calls[0].body }, {
    method: 'POST',
    path: `/v2/messages/conversations/${C}/messages`,
    body: { request_id: R, body: '안녕' },
  });
  assert.equal(calls[0].requestId, R);
});

test('messages api: 차단 403 message_blocked 는 사유 코드를 담은 오류다', async (t) => {
  capture(t, { detail: 'message_blocked' }, 403);
  await assert.rejects(api.sendMessage(C, { request_id: id(8), body: '안녕' }), (e) => e.status === 403 && e.code === 'message_blocked');
});
