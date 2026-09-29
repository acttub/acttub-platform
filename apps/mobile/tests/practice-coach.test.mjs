import assert from 'node:assert/strict';
import test from 'node:test';

import { attemptFor, fingerprintOf } from '../lib/practice/start.ts';
import {
  COACH_END_WORD,
  answerTooLong,
  buildReplyBody,
  canSendAnswer,
  coachFailure,
  helpButtonDraft,
  isClosed,
  isEndWord,
  nextReplyWraps,
  orderedMessages,
  remainingCoachReplies,
} from '../lib/practice/coach.ts';
import { COACH_ANSWER_MAX } from '../lib/practice/types.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });

const conversation = (over = {}) => ({
  id: 'conv-1',
  practice_id: 'practice-1',
  status: 'open',
  revision: 3,
  coach_reply_count: 1,
  reply_limit: 8,
  messages: [],
  ...over,
});

test('practice.coach: 300자 답은 보내고 301자는 화면이 먼저 막는다', () => {
  const ok = '가'.repeat(COACH_ANSWER_MAX);
  const over = '가'.repeat(COACH_ANSWER_MAX + 1);

  assert.equal(COACH_ANSWER_MAX, 300);
  assert.equal(answerTooLong(ok), false);
  assert.equal(answerTooLong(over), true);
  assert.equal(canSendAnswer({ text: ok, waiting: false, closed: false, conversationId: 'conv-1' }), true);
  assert.equal(canSendAnswer({ text: over, waiting: false, closed: false, conversationId: 'conv-1' }), false);
});

test('practice.coach: 답장 본문에는 대화 id·요청 id·그때의 revision 이 실린다', () => {
  const body = buildReplyBody({ conversation: conversation(), requestId: 'req-1', text: '  기다리고 있었어요  ' });

  assert.deepEqual(body, {
    conversation_id: 'conv-1',
    request_id: 'req-1',
    text: '기다리고 있었어요',
    revision: 3,
  });
});

test('practice.coach: 같은 답을 다시 보내면 같은 요청 id 다 — 메시지가 늘지 않는다', () => {
  let n = 0;
  const makeId = () => `req-${(n += 1)}`;
  const text = '상대 얼굴을 보고 있었어요';
  const first = attemptFor(null, text, makeId);
  const again = attemptFor(first, text, makeId);

  assert.deepEqual(again, first);
  assert.equal(n, 1);
  // 본문을 고쳐 보내면 새 요청 id 다(같은 id·다른 본문은 422 request_fingerprint_mismatch).
  const edited = attemptFor(again, '다른 답', makeId);
  assert.notEqual(edited.requestId, first.requestId);
  assert.equal(typeof fingerprintOf, 'function');
});

test('practice.coach: 기존 갈래는 코치 응답 8개, 신형은 10개가 상한이고 마무리를 미리 안다', () => {
  assert.equal(remainingCoachReplies(conversation({ coach_reply_count: 7, reply_limit: 8 })), 1);
  assert.equal(nextReplyWraps(conversation({ coach_reply_count: 7, reply_limit: 8 })), true);
  assert.equal(nextReplyWraps(conversation({ coach_reply_count: 6, reply_limit: 8 })), false);
  assert.equal(nextReplyWraps(conversation({ coach_reply_count: 9, reply_limit: 10 })), true);
  assert.equal(remainingCoachReplies(conversation({ coach_reply_count: 10, reply_limit: 10 })), 0);
});

test('practice.coach: 닫힌 대화에는 보낼 수 없고 "그만"은 언제든 마친다', () => {
  const closed = conversation({ status: 'closed' });
  assert.equal(isClosed(closed), true);
  assert.equal(canSendAnswer({ text: '답', waiting: false, closed: true, conversationId: 'conv-1' }), false);
  assert.equal(isEndWord(` ${COACH_END_WORD} `), true);
  assert.equal(isEndWord('그만두고 싶진 않아요'), false);
});

test('practice.coach: 도움 버튼은 입력만 준비하고 보내지 않는다', () => {
  assert.equal(typeof helpButtonDraft('explain'), 'string');
  assert.notEqual(helpButtonDraft('explain'), '');
  assert.notEqual(helpButtonDraft('later'), '');
  // "제가 되물을게요"는 배우가 직접 쓰도록 빈 칸을 준다 — 버튼만으로는 보낼 것이 없다.
  assert.equal(helpButtonDraft('ask_back'), '');
  assert.equal(
    canSendAnswer({ text: helpButtonDraft('ask_back'), waiting: false, closed: false, conversationId: 'conv-1' }),
    false,
  );
});

test('practice.coach: 충돌·닫힘·분석 미완·지문 불일치를 갈라 본다', () => {
  assert.deepEqual(coachFailure(apiError(409, 'conversation_conflict')), { kind: 'conflict' });
  assert.deepEqual(coachFailure(apiError(409, 'conversation_closed')), { kind: 'closed' });
  assert.deepEqual(coachFailure(apiError(409, 'analysis_not_ready')), { kind: 'not_ready' });
  assert.deepEqual(coachFailure(apiError(422, 'request_fingerprint_mismatch')), { kind: 'fingerprint_mismatch' });
  assert.deepEqual(coachFailure(Object.assign(new Error('x'), { name: 'NetworkError' })), { kind: 'offline' });
});

test('practice.coach: 화면은 turn_index 순서로 그린다', () => {
  const messages = orderedMessages(
    conversation({
      messages: [
        { turn_index: 2, role: 'coach', text: '두 번째 질문' },
        { turn_index: 0, role: 'coach', text: '첫 질문' },
        { turn_index: 1, role: 'actor', text: '답' },
      ],
    }),
  );

  assert.deepEqual(messages.map((m) => m.turn_index), [0, 1, 2]);
  assert.equal(messages[0].text, '첫 질문');
});

test('splitCoachQuestion: 마지막 물음 문장만 질문으로 크게, 앞의 관찰은 힌트로 나눈다', async () => {
  const { splitCoachQuestion } = await import('../lib/practice/coach.ts');

  assert.deepEqual(
    splitCoachQuestion('첫 대사 직전에 컵을 내려놓는 순간이 있었어요. 그때 서연은 무엇을 결심하고 있었나요?'),
    { question: '그때 서연은 무엇을 결심하고 있었나요?', hint: '첫 대사 직전에 컵을 내려놓는 순간이 있었어요.' },
  );
  // 따옴표 안의 마침표·줄바꿈이 있어도 마지막 물음 문장 기준이다
  assert.deepEqual(
    splitCoachQuestion('"우리 그만하자"를 말하고 바로 시선을 피했어요.\n상대의 얼굴을 보지 않은 건 의도한 선택이었나요?'),
    { question: '상대의 얼굴을 보지 않은 건 의도한 선택이었나요?', hint: '"우리 그만하자"를 말하고 바로 시선을 피했어요.' },
  );
  // 한 문장이거나 물음으로 끝나지 않으면 나누지 않는다
  assert.deepEqual(splitCoachQuestion('지금 연기에서 어느 쪽이 더 막히나요?'), { question: '지금 연기에서 어느 쪽이 더 막히나요?', hint: null });
  assert.deepEqual(splitCoachQuestion('좋아요. 노트로 정리할게요.'), { question: '좋아요. 노트로 정리할게요.', hint: null });
  assert.deepEqual(splitCoachQuestion('  '), { question: '', hint: null });
});
