// practice.coach — 대화 시작·답·조회의 경로·본문·오류. 가짜 fetch 로 바깥 동작만 본다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const {
  ACTOR_REPLY_MAX,
  conversationErrorMessage,
  getConversation,
  isClosedConversation,
  isConversationConflict,
  isFingerprintMismatch,
  replyConversation,
  startConversation,
} = await import("../src/lib/api/v2/coach-conversations.ts");
const { errorMessage } = await import("../src/lib/api/v2/errors.ts");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      path: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : null,
      requestId: new Headers(init.headers ?? {}).get("X-Request-Id"),
    };
    calls.push(call);
    return handler(call);
  };
  return calls;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TURN = {
  conversation: { id: "c-1", revision: 4, status: "open" },
  message: "그 순간에 무엇을 하려고 했나요?",
  note: null,
};

test("practice.coach: 시작은 request_id 를 싣고 대화 id·revision 을 받는다. 재전송은 같은 대화다", async () => {
  const calls = stub(() => json({ ...TURN, conversation: { id: "c-1", revision: 1, status: "open" } }));

  const first = await startConversation("practice-1", { requestId: "req-1" });
  const again = await startConversation("practice-1", { requestId: "req-1" });

  assert.equal(first.conversation.id, "c-1");
  assert.equal(first.conversation.revision, 1);
  assert.deepEqual(calls[0], {
    path: "/v2/coach/start",
    method: "POST",
    body: { practice_id: "practice-1", request_id: "req-1" },
    requestId: "req-1",
  });
  // 같은 요청 id 를 그대로 보낸다 — 서버가 먼저 만든 대화를 그대로 돌려준다.
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.equal(again.conversation.id, first.conversation.id);
});

test("practice.coach: 답은 대화 id·요청 id·본문·revision 을 함께 보낸다", async () => {
  const calls = stub(() => json(TURN));

  const turn = await replyConversation(
    { conversationId: "c-1", text: "  붙잡고 싶었어요  ", revision: 3 },
    { requestId: "req-9" },
  );

  assert.deepEqual(calls[0], {
    path: "/v2/coach/reply",
    method: "POST",
    // 앞뒤 공백은 떼고 보낸다 — 같은 답을 두 번 보내면 지문이 달라질 이유가 없어야 한다.
    body: { conversation_id: "c-1", request_id: "req-9", text: "붙잡고 싶었어요", revision: 3 },
    requestId: "req-9",
  });
  assert.equal(turn.conversation.revision, 4);
  assert.equal(turn.conversation.status, "open");
});

test("practice.coach: 배우 답은 300자까지다", async () => {
  const calls = stub(() => json(TURN));
  assert.equal(ACTOR_REPLY_MAX, 300);

  await assert.rejects(
    () => replyConversation({ conversationId: "c-1", text: "가".repeat(301), revision: 1 }, { requestId: "r" }),
    /300자/,
  );
  // 길이로 걸린 답은 서버까지 가지 않는다.
  assert.equal(calls.length, 0);

  await replyConversation({ conversationId: "c-1", text: "가".repeat(300), revision: 1 }, { requestId: "r" });
  assert.equal(calls.length, 1);
});

test("practice.coach: 충돌·종료·지문 불일치를 갈라 화면이 다르게 대응한다", async () => {
  // 오류 코드는 본문의 detail 로 온다(공용 클라이언트가 그렇게 읽는다).
  const conflict = () => json({ detail: "conversation_conflict" }, 409);
  const closed = () => json({ detail: "conversation_closed" }, 409);
  const mismatch = () => json({ detail: "request_fingerprint_mismatch" }, 422);

  const reply = async (response) => {
    stub(response);
    try {
      await replyConversation({ conversationId: "c-1", text: "네", revision: 1 }, { requestId: "r" });
      return null;
    } catch (cause) {
      return cause;
    }
  };

  const conflictError = await reply(conflict);
  assert.equal(isConversationConflict(conflictError), true);
  assert.equal(isClosedConversation(conflictError), false);
  // 충돌은 배우 잘못이 아니다 — 다시 읽고 그대로 보낼 수 있다고 말한다.
  assert.equal(conversationErrorMessage(conflictError), "방금 대화가 바뀌었어요. 최신 내용을 불러왔어요. 다시 보내 주세요.");

  const closedError = await reply(closed);
  assert.equal(isClosedConversation(closedError), true);
  assert.equal(conversationErrorMessage(closedError), "이미 마친 대화예요. 이어서 연습하려면 새 회차를 시작해 주세요.");

  const mismatchError = await reply(mismatch);
  assert.equal(isFingerprintMismatch(mismatchError), true);
  // 같은 코드를 리딩 대본 저장도 쓴다 — 대화의 문구는 대화 모듈이 고른다.
  assert.equal(conversationErrorMessage(mismatchError), "먼저 보낸 답과 달라요. 화면을 새로 고친 뒤 다시 보내 주세요.");
  assert.match(errorMessage(mismatchError, "실패"), /대본/);
});

test("practice.coach: 대화 조회는 최신 revision·상태·턴을 돌려준다", async () => {
  const calls = stub(() =>
    json({
      id: "c-1",
      practice_id: "practice-1",
      status: "open",
      revision: 7,
      close_reason: null,
      created_at: "2026-09-21T03:00:00Z",
      messages: [
        { turn_index: 1, role: "coach", text: "무엇을 하려 했나요?", created_at: "2026-09-21T03:00:00Z" },
        { turn_index: 2, role: "actor", text: "붙잡고 싶었어요", created_at: "2026-09-21T03:01:00Z" },
      ],
    }),
  );

  const conversation = await getConversation("c-1");

  assert.deepEqual(calls[0], { path: "/v2/coach/conversations/c-1", method: "GET", body: null, requestId: null });
  assert.equal(conversation.revision, 7);
  assert.deepEqual(conversation.messages.map((t) => t.role), ["coach", "actor"]);
});

test("practice.coach: 종료 응답은 노트를 함께 싣는다", async () => {
  stub(() =>
    json({
      conversation: { id: "c-1", revision: 9, status: "closed" },
      message: "오늘은 여기까지 해요.",
      note: { id: "n-1", kind: "action", title: "말끝", fallback: false },
    }),
  );

  const turn = await replyConversation({ conversationId: "c-1", text: "그만", revision: 8 }, { requestId: "r" });

  assert.equal(turn.conversation.status, "closed");
  assert.equal(turn.conversation.status, "closed");
  assert.equal(turn.note?.id, "n-1");
});
