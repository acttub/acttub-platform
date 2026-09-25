import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommentBody,
  canDeleteComment,
  canReact,
  canSendComment,
  commentAttemptFor,
  commentAuthorName,
  commentBody,
  commentText,
  commentTooLong,
  optimisticLike,
  optimisticSave,
  reactFailure,
  revertLike,
} from '../lib/challenge/react.ts';
import { COMMENT_MAX } from '../lib/challenge/types.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });

test('challenge.react: 좋아요는 눌린 즉시 표시가 바뀌고 서버가 실패하면 되돌린다', () => {
  const before = { liked: false, likeCount: 5 };
  const after = optimisticLike(before);

  assert.deepEqual(after, { liked: true, likeCount: 6 });
  // 다시 누르면 꺼지고 수가 준다(멱등하게 보인다).
  assert.deepEqual(optimisticLike(after), { liked: false, likeCount: 5 });
  // 실패하면 누르기 전 값으로 돌아간다.
  assert.deepEqual(revertLike(before), before);
  // 0에서 취소해도 음수가 되지 않는다.
  assert.deepEqual(optimisticLike({ liked: true, likeCount: 0 }), { liked: false, likeCount: 0 });
});

test('challenge.react: 자기 참여작에는 좋아요·저장을 하지 않는다', () => {
  assert.equal(canReact({ is_mine: true }), false);
  assert.equal(canReact({ is_mine: false }), true);
  assert.equal(canReact({}), true);
  assert.deepEqual(reactFailure(apiError(422, 'self_like')), { kind: 'self' });
  assert.deepEqual(reactFailure(apiError(422, 'self_save')), { kind: 'self' });
});

test('challenge.react: 저장은 켜고 끄는 것이고 자기 것은 못 한다', () => {
  assert.equal(optimisticSave(false), true);
  assert.equal(optimisticSave(true), false);
});

test('challenge.react: 댓글은 공백 정리 뒤 1~500자다', () => {
  assert.equal(COMMENT_MAX, 500);
  assert.equal(commentBody('   '), null);
  assert.equal(commentBody('  좋은   연기였어요  '), '좋은 연기였어요');
  assert.equal(canSendComment(''), false);
  assert.equal(canSendComment('  '), false);
  assert.equal(canSendComment('가'.repeat(COMMENT_MAX)), true);
  assert.equal(commentTooLong('가'.repeat(COMMENT_MAX + 1)), true);
  assert.equal(canSendComment('가'.repeat(COMMENT_MAX + 1)), false);
  assert.deepEqual(buildCommentBody('req-1', ' 한 줄 '), { request_id: 'req-1', body: '한 줄' });
});

test('challenge.react: 같은 댓글의 재전송은 같은 요청 id 다 — 행이 늘지 않는다', () => {
  let n = 0;
  const makeId = () => `req-${(n += 1)}`;

  const first = commentAttemptFor(null, '한 줄', makeId);
  const again = commentAttemptFor(first, '한 줄', makeId);
  assert.deepEqual(again, first);
  assert.equal(n, 1);
  assert.notEqual(commentAttemptFor(again, '다른 줄', makeId).requestId, first.requestId);
});

test('challenge.react: 탈퇴한 작성자는 "탈퇴한 사용자"로 보이고 이름 말고는 없다', () => {
  const comment = { author: { name: '윤서' }, author_withdrawn: false };

  assert.equal(commentAuthorName(comment), '윤서');
  assert.equal(commentAuthorName({ ...comment, author_withdrawn: true }), '탈퇴한 사용자');
});

test('challenge.react: 신고로 숨겨진 내 댓글은 원래 자리에 "확인 중"으로 보이고 지울 수 있다', () => {
  const hidden = { status: 'hidden', body: null, is_mine: true };

  assert.match(commentText(hidden), /확인 중/);
  assert.equal(canDeleteComment(hidden), true);
  assert.equal(canDeleteComment({ is_mine: false }), false);
  assert.equal(commentText({ status: 'visible', body: '좋아요', is_mine: false }), '좋아요');
});

test('challenge.react: 비공개·삭제·차단은 404, 하루 한도는 429 로 갈라 본다', () => {
  assert.deepEqual(reactFailure(apiError(404)), { kind: 'not_found' });
  assert.deepEqual(reactFailure(apiError(429, 'daily_comment_limit')), { kind: 'daily_limit' });
  assert.deepEqual(reactFailure(apiError(403, 'member_only')), { kind: 'member_only' });
  assert.deepEqual(reactFailure(Object.assign(new Error('x'), { name: 'NetworkError' })), { kind: 'offline' });
});
