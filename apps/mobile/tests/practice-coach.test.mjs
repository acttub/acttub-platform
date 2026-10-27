import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintOf } from '../lib/practice/start.ts';
import { attemptFor } from '../lib/request-id.ts';
import {
  answerChoices,
  COACH_END_WORD,
  answerTooLong,
  buildReplyBody,
  canContinueConversation,
  canSendAnswer,
  coachFailureMessage,
  coachFailure,
  helpButtonDraft,
  isClosed,
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

test('practice.coach: 기존 갈래는 액티 응답 8개, 신형은 10개가 상한이고 마무리를 미리 안다', () => {
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
  assert.equal(COACH_END_WORD, '그만');
});

test('practice.coach: 도움 버튼은 입력만 준비하고 보내지 않는다', () => {
  assert.notEqual(helpButtonDraft('yes'), '');
  assert.notEqual(helpButtonDraft('no'), '');
});

test('practice.coach: 「액티에게 질문」 버튼은 없다 — 질문은 입력칸에 그대로 쓴다(SOMA-634)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.doesNotMatch(read('../app/coach.tsx'), /ask_back|quickAskBack|askingCoach|questionPh/);
  assert.doesNotMatch(read('../lib/practice/coach.ts'), /ask_back/);
  assert.doesNotMatch(read('../locales/ko.ts'), /quickAskBack|코치에게 질문"으로/);
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

test('coach 화면: 액티의 마지막 말을 질문·힌트로 나누지 않고 원문 그대로 한 칸에 보인다(SOMA-634)', async () => {
  const { readFileSync } = await import('node:fs');
  const coachLib = readFileSync(new URL('../lib/practice/coach.ts', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../app/coach.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(coachLib, /splitCoachQuestion/);
  assert.doesNotMatch(screen, /splitCoachQuestion|latest\.hint|styles\.hint/);
  // 원문 한 칸 그대로 — 「0:12」 같은 시간만 누를 수 있게 칠한다(SOMA-748). 글을 나누거나 빼지 않는다.
  assert.match(screen, /<Text style=\{styles\.question\}>\{withTimestamps\(message\.text\.trim\(\)\)\}<\/Text>/);
  assert.match(screen, /<Text style=\{styles\.question\}>\{withTimestamps\(streamText\.trim\(\)\)\}<\/Text>/);
});

test('대화 이어하기(SOMA-782): 닫힌 대화이고 예시 회차가 아닐 때만 보인다', () => {
  assert.equal(canContinueConversation(conversation({ status: 'closed' }), false), true);
  assert.equal(canContinueConversation(conversation({ status: 'open' }), false), false);
  assert.equal(canContinueConversation(conversation({ status: 'closed' }), true), false);
  assert.equal(canContinueConversation(null, false), false);
});

test('대화 이어하기가 거절되는 까닭을 가른다', () => {
  assert.deepEqual(coachFailure(apiError(409, 'conversation_limit_reached')), { kind: 'limit_reached' });
  assert.deepEqual(coachFailure(apiError(409, 'conversation_not_resumable')), { kind: 'not_resumable' });
  assert.match(coachFailureMessage({ kind: 'limit_reached' }), /많이 이어졌어요/);
  assert.match(coachFailureMessage({ kind: 'not_resumable' }), /이어 갈 수 없어요/);
});

test('질문 대화의 답 버튼: 서버 예시 답 1~2개 + 잘 모르겠어요, 기다리는 동안·목적별·닫힌 대화·질문 아님에는 없다', () => {
  const asked = { messages: [{ turn_index: 0, role: 'coach', text: '상대는 어디 있었어요?', created_at: null }] };
  const withExamples = conversation({ ...asked, answer_examples: ['멀리 있었어요', ' 바로 앞에 있었어요 ', '셋째'] });
  assert.deepEqual(answerChoices(withExamples, { busy: false }), ['멀리 있었어요', '바로 앞에 있었어요', '잘 모르겠어요']);
  // 옛 서버(예시 답 없음)도 「잘 모르겠어요」는 남는다. 고정 「맞아요·아니요」는 없다.
  assert.deepEqual(answerChoices(conversation(asked), { busy: false }), ['잘 모르겠어요']);
  // 서버가 「잘 모르겠어요」를 예시로 줘도 두 번 나오지 않는다.
  assert.deepEqual(answerChoices(conversation({ ...asked, answer_examples: ['잘 모르겠어요'] }), { busy: false }), ['잘 모르겠어요']);
  assert.deepEqual(answerChoices(withExamples, { busy: true }), []);
  assert.deepEqual(answerChoices(null, { busy: false }), []);
  assert.deepEqual(answerChoices(conversation({ ...asked, status: 'closed' }), { busy: false }), []);
  assert.deepEqual(answerChoices(conversation({ ...asked, purpose: { purpose: 'stuck', step: 'reason', choices: [] } }), { busy: false }), []);
  const answered = conversation({ messages: [...asked.messages, { turn_index: 1, role: 'actor', text: '멀리요', created_at: null }] });
  assert.deepEqual(answerChoices(answered, { busy: false }), []);
});

test('허용 범위 밖 글자(결합 기호를 쌓은 글·보이지 않는 글자)가 섞인 답은 보내지 않는다', async () => {
  const { readableText, hasUnreadableText } = await import('../lib/practice/readable-text.ts');
  for (const ok of ['옆 사람이 웃는지 궁금해서 봤어요', 'ㅋㅋㅋ 모르겠어요ㅠㅠ...', 'I see!', '「그만」… “진짜”요? ※ →', '좋아요 👍🏻😂 ❤️‍🔥 👨‍👩‍👧 🇰🇷 1️⃣', 'cafe\u0301 ₩3,900']) {
    assert.equal(readableText(ok), true, ok);
  }
  for (const bad of ['Z\u0325\u031c\u0318\u0316a\u031clgo...', '안녕\u0301', '\u200B', '네\u200B', '\u202Eabc', '\u200D', 'a\uFE0F\uFE0F', '漢字', 'こんにちは', '   ']) {
    assert.equal(readableText(bad), false, JSON.stringify(bad));
  }
  assert.equal(hasUnreadableText(''), false);
  assert.equal(hasUnreadableText('Z\u0325\u031c'), true);
  assert.equal(canSendAnswer({ text: 'Z\u0325\u031c\u0318', waiting: false, closed: false, conversationId: 'conv-1' }), false);
  assert.equal(coachFailure(Object.assign(new Error('x'), { status: 400, code: 'unreadable_text' })).kind, 'unreadable');
});
