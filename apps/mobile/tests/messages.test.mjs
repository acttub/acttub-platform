import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import {
  MESSAGE_MAX,
  bubbles,
  canSendBody,
  listTime,
  mergeMessages,
  messageTarget,
  sendFailure,
  startFailure,
  unavailableKey,
  unreadBadge,
} from '../lib/messages.ts';
import { reminderTarget } from '../lib/reminder-target.ts';

const apiError = (status, code) => new ApiError(status, 'x', code);
const message = (id, at, mine = false) => ({ id, conversation_id: 'c', body: id, mine, created_at: at });

test('messageTarget: 남의 글·댓글 작성자만 대화 상대다 — 내 것·작성자를 모르는 것은 null', () => {
  assert.equal(messageTarget({ author: { id: 'u1' }, is_mine: false }), 'u1');
  assert.equal(messageTarget({ author: { id: 'u1' }, is_mine: true }), null);
  assert.equal(messageTarget({ author: { id: 'u1' }, mine: true }), null);
  assert.equal(messageTarget({ author: { id: null } }), null);
  assert.equal(messageTarget({}), null);
});

test('mergeMessages: 같은 id 는 하나만, 오래된 것부터 줄 세운다', () => {
  const have = [message('b', '2026-11-28T00:00:02Z'), message('a', '2026-11-28T00:00:01Z')];
  const incoming = [message('c', '2026-11-28T00:00:03Z'), { ...message('b', '2026-11-28T00:00:02Z'), body: '새 본문' }];
  const merged = mergeMessages(have, incoming);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(merged[1].body, '새 본문');
  // 같은 시각이면 id 순서다.
  assert.deepEqual(mergeMessages([], [message('y', '2026-11-28T00:00:01Z'), message('x', '2026-11-28T00:00:01Z')]).map((m) => m.id), ['x', 'y']);
});

test('bubbles: 보낸 메시지 아래에 기기의 말풍선이 보낸 순서대로 온다', () => {
  const list = bubbles([message('a', '2026-11-28T00:00:01Z')], [
    { key: 'p1', requestId: 'r1', body: '하나', status: 'sending' },
    { key: 'p2', requestId: 'r2', body: '둘', status: 'failed' },
  ]);
  assert.deepEqual(list.map((b) => [b.kind, b.key]), [['sent', 'a'], ['pending', 'p1'], ['pending', 'p2']]);
});

test('canSendBody: 앞뒤 공백을 걷고 1~1000자', () => {
  assert.equal(canSendBody('   '), false);
  assert.equal(canSendBody(' 안녕 '), true);
  assert.equal(canSendBody('가'.repeat(MESSAGE_MAX)), true);
  assert.equal(canSendBody('가'.repeat(MESSAGE_MAX + 1)), false);
  // 이모지 하나는 한 글자다.
  assert.equal(canSendBody('😀'.repeat(MESSAGE_MAX)), true);
});

test('sendFailure·startFailure: 서버 사유를 화면 갈래로 옮긴다', () => {
  assert.equal(sendFailure(apiError(403, 'message_blocked')), 'blocked');
  assert.equal(sendFailure(apiError(403, 'partner_unavailable')), 'partner_left');
  assert.equal(sendFailure(apiError(429, 'daily_message_limit')), 'daily_limit');
  assert.equal(sendFailure(new Error('network')), 'other');
  assert.equal(startFailure(apiError(403, 'message_blocked')), 'blocked');
  assert.equal(startFailure(apiError(403, 'member_only')), 'member_only');
  assert.equal(startFailure(apiError(404, 'user_not_found')), 'gone');
  assert.equal(startFailure(apiError(429, 'daily_conversation_limit')), 'daily_limit');
  assert.equal(startFailure(apiError(500, 'x')), 'other');
});

test('unavailableKey: 보낼 수 없는 대화방의 안내', () => {
  assert.equal(unavailableKey({ can_send: true, unavailable_reason: null }), null);
  assert.equal(unavailableKey({ can_send: false, unavailable_reason: 'partner_unavailable' }), 'messages.partnerLeft');
  assert.equal(unavailableKey({ can_send: false, unavailable_reason: 'message_blocked' }), 'messages.blocked');
});

test('unreadBadge·listTime', () => {
  assert.equal(unreadBadge(0), null);
  assert.equal(unreadBadge(null), null);
  assert.equal(unreadBadge(7), '7');
  assert.equal(unreadBadge(120), '99+');
  assert.equal(listTime({ last_message_at: null }), '');
  assert.notEqual(listTime({ last_message_at: '2026-11-28T00:00:00Z' }, new Date('2026-11-28T00:05:00Z')), '');
});

test('reminderTarget: 새 메시지 푸시를 누르면 그 대화가 열린다', () => {
  const id = '00000000-0000-4000-8000-000000001039';
  assert.equal(reminderTarget({ kind: 'direct_message', conversation_id: id }), `/messages/${id}`);
  assert.equal(reminderTarget({ kind: 'direct_message', conversation_id: 'nope' }), '/messages');
});
