import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { loadPracticeSession } = await import(
  "../src/features/workspace/session-loading.ts"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 1.0.0 의 노트(practice.note). 회차 경로로 온다.
const REPORT = {
  id: "n-1",
  format: "v2",
  kind: "action",
  title: "무엇이 막혔나",
  summary_quotes: [],
  next_take: null,
  actor_words: [],
  corrections: [],
  tags: [],
  fallback: false,
  cheer: null,
  source_revision: 4,
  created_at: "2026-09-21T03:00:00Z",
};

function detail(overrides = {}) {
  return {
    id: "practice-1",
    root_id: "practice-1",
    ordinal: 1,
    stage: "conversing",
    experience_version: "legacy",
    video_id: null,
    situation: "면접 첫 인사", character: "", goal: "",
    blockage_category: "표현", blockage_detail: "움직임", blockage_note: null,
    job: { id: "j-1", status: "succeeded", failure_reason: null },
    analysis_status: "ready",
    conversation: null,
    note: null,
    created_at: "2026-09-21T03:00:00Z",
    updated_at: "2026-09-21T03:00:00Z",
    ...overrides,
  };
}

/** 아직 분석 중인 회차 */
const ANALYZING = { stage: "analyzing", job: { id: "j-1", status: "pending", failure_reason: null }, analysis_status: null };
/** 분석이 최종 실패한 회차 */
const FAILED = { stage: "closed", job: { id: "j-1", status: "failed", failure_reason: "timeout" }, analysis_status: null };

/**
 * 조회 두 개를 받아 적는 fetch. 회차 조회와 노트 조회가 어느 순서로, 몇 번
 * 불렸는지가 결과만큼이나 중요하다 — 훑어보기가 안 끝난 연습은 노트를 물어보면 안 된다.
 */
function apiStub({ session = () => jsonResponse(detail()), report } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith("/analysis")) return jsonResponse({ detail: "analysis_not_found" }, 404);
    calls.push(path);
    if (path.endsWith("/note")) {
      return report ? report() : jsonResponse(REPORT);
    }
    assert.equal(path, "/v2/practices/practice-1");
    return session();
  };
  return calls;
}

function loadInput(overrides = {}) {
  return {
    sessionId: "practice-1",
    isCurrent: () => true,
    onLoaded: () => {},
    ...overrides,
  };
}

test("노트 없이 닫힌 회차는 새 코칭을 시작하지 않고 저장된 대화를 읽는다", async () => {
  const conversation = { id: "c1", status: "closed", revision: 2, close_reason: "actor_finished",
    messages: [{ role: "coach", turn_index: 1, text: "오늘은 여기까지예요" }], coach_reply_count: 1, reply_limit: 8 };
  globalThis.fetch = async (url) => {
    if (url === "/v2/practices/practice-1") return jsonResponse(detail({ stage: "closed", conversation_id: "c1", conversation_status: "closed" }));
    if (url.endsWith("/analysis")) return jsonResponse({ detail: "analysis_not_found" }, 404);
    if (url === "/v2/practices/practice-1/note") return jsonResponse({ detail: "note_not_found" }, 404);
    assert.equal(url, "/v2/coach/conversations/c1");
    return jsonResponse(conversation);
  };
  const result = await loadPracticeSession(loadInput());
  assert.deepEqual(result, { kind: "conversation", conversation });
});

test("훑어보기가 안 끝난 연습은 폴링을 걸라고 답하고 노트를 물어보지 않는다", async () => {
  const calls = apiStub({
    session: () => jsonResponse(detail(ANALYZING)),
  });
  const result = await loadPracticeSession(loadInput());
  assert.deepEqual(result, { kind: "analyzing" });
  assert.deepEqual(calls, ["/v2/practices/practice-1"]);
});

test("훑어보기가 실패한 연습은 그 자리에서 멈추고 노트를 물어보지 않는다", async () => {
  const calls = apiStub({ session: () => jsonResponse(detail(FAILED)) });
  const result = await loadPracticeSession(loadInput());
  assert.deepEqual(result, { kind: "analysisFailed" });
  assert.deepEqual(calls, ["/v2/practices/practice-1"]);
});

test("훑어보기가 끝난 연습은 노트를 물어보고 받은 것을 그대로 싣는다", async () => {
  const calls = apiStub();
  const result = await loadPracticeSession(loadInput());
  assert.deepEqual(result, { kind: "note", report: REPORT });
  assert.deepEqual(calls, [
    "/v2/practices/practice-1",
    "/v2/practices/practice-1/note",
  ]);
});

test("노트가 없으면 코치를 부를 자리라고 답한다", async () => {
  apiStub({ report: () => jsonResponse({ detail: "not found" }, 404) });
  const result = await loadPracticeSession(loadInput());
  assert.deepEqual(result, { kind: "noNote" });
});

test("연습을 못 불러오면 실패를 그 까닭과 함께 돌려준다", async () => {
  apiStub({ session: () => jsonResponse({ detail: "not found" }, 404) });
  const result = await loadPracticeSession(loadInput());
  assert.equal(result.kind, "loadFailed");
  assert.ok(result.cause instanceof Error);
});

test("화면을 옮기는 자리가 터져도 실패로 돌아온다", async () => {
  apiStub();
  const boom = new Error("dispatch 가 터졌다");
  const result = await loadPracticeSession(
    loadInput({
      onLoaded: () => {
        throw boom;
      },
    }),
  );
  assert.deepEqual(result, { kind: "loadFailed", cause: boom });
});

test("받아 온 연습은 무엇을 더 할지 갈리기 전에 화면으로 넘어간다", async () => {
  const order = [];
  apiStub({
    session: () => {
      order.push("세션 조회");
      return jsonResponse(detail());
    },
    report: () => {
      order.push("노트 조회");
      return jsonResponse({ report: REPORT });
    },
  });
  const loaded = [];
  await loadPracticeSession(
    loadInput({
      onLoaded: (received) => {
        order.push("화면으로");
        loaded.push(received);
      },
    }),
  );
  assert.deepEqual(order, ["세션 조회", "화면으로", "노트 조회"]);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].status, "analyzed");
});

test("기다리는 사이 다른 연습이 자리를 차지하면 화면을 건드리지 않는다", async () => {
  const calls = apiStub();
  const loaded = [];
  const result = await loadPracticeSession(
    loadInput({
      isCurrent: () => false,
      onLoaded: (received) => loaded.push(received),
    }),
  );
  assert.deepEqual(result, { kind: "superseded" });
  assert.deepEqual(loaded, []);
  // 자리를 뺏겼으면 노트까지 물어보지 않는다.
  assert.deepEqual(calls, ["/v2/practices/practice-1"]);
});

test("노트를 물어보는 사이 자리를 뺏기면 그 노트를 싣지 않는다", async () => {
  apiStub();
  let current = true;
  const result = await loadPracticeSession(
    loadInput({
      isCurrent: () => current,
      onLoaded: () => {
        current = false;
      },
    }),
  );
  assert.deepEqual(result, { kind: "superseded" });
});

test("노트가 없다는 답이 오는 사이 자리를 뺏겨도 코치를 부르지 않는다", async () => {
  apiStub({ report: () => jsonResponse({ detail: "not found" }, 404) });
  let current = true;
  const result = await loadPracticeSession(
    loadInput({
      isCurrent: () => current,
      onLoaded: () => {
        current = false;
      },
    }),
  );
  assert.deepEqual(result, { kind: "superseded" });
});

test("자리를 뺏긴 뒤에 온 조회 실패는 오류로 올라오지 않는다", async () => {
  apiStub({ session: () => jsonResponse({ detail: "not found" }, 404) });
  const result = await loadPracticeSession(
    loadInput({ isCurrent: () => false }),
  );
  assert.deepEqual(result, { kind: "superseded" });
});
