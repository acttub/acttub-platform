// practice.coach — 대화 응답을 화면 줄로 옮기는 규칙.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { actorTurnCount, conversationLines, isConversationDone, needsTurnHistory } = await import(
  "../src/features/practice/conversation-view.ts"
);

const conversation = {
  id: "c-1",
  practice_id: "p-1",
  status: "open",
  revision: 4,
  closed_reason: null,
  created_at: "2026-09-21T03:00:00Z",
  turns: [
    { turn_index: 2, role: "actor", text: "붙잡고 싶었어요", created_at: "2026-09-21T03:01:00Z" },
    { turn_index: 1, role: "coach", text: "무엇을 하려 했나요?", created_at: "2026-09-21T03:00:00Z" },
    { turn_index: 3, role: "coach", text: "그 말이 어디로 갔나요?", created_at: "2026-09-21T03:02:00Z" },
  ],
};

test("practice.coach: 대화를 다시 읽으면 턴 순서대로 화면 줄이 선다", () => {
  assert.deepEqual(conversationLines(conversation), [
    { role: "ai", text: "무엇을 하려 했나요?" },
    { role: "me", text: "붙잡고 싶었어요" },
    { role: "ai", text: "그 말이 어디로 갔나요?" },
  ]);
});

test("practice.coach: 배우가 보낸 답의 수를 센다 — 영상만 올린 시작에는 배우 턴이 없다", () => {
  assert.equal(actorTurnCount(conversation), 1);
  assert.equal(actorTurnCount({ ...conversation, turns: [conversation.turns[1]] }), 0);
});

test("practice.coach: 종료는 응답 상태와 대화 상태 어느 쪽으로도 알 수 있다", () => {
  const head = { id: "c-1", revision: 5, status: "open" };
  assert.equal(isConversationDone({ conversation: head, message: "", status: "continue", note: null }), false);
  assert.equal(isConversationDone({ conversation: head, message: "", status: "complete", note: null }), true);
  assert.equal(
    isConversationDone({ conversation: { ...head, status: "closed" }, message: "", status: "continue", note: null }),
    true,
  );
});

test("practice.coach: 새로 연 대화는 조회 없이 서고, 재개한 대화는 지난 턴을 읽는다", () => {
  const start = (revision) => ({ conversation: { id: "c-1", revision, status: "open" }, message: "첫 질문", status: "continue", note: null });
  assert.equal(needsTurnHistory(start(1)), false);
  assert.equal(needsTurnHistory(start(6)), true);
});
