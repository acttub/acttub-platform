// reading.session — 회차 서버 클라이언트. 시작(요청 id 멱등)·목록·상세·진행 저장·삭제와 문구.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createSession, deleteSession, getSession, listSessions, saveProgress } = await import("../src/lib/api/v2/reading-sessions.ts");
const { ApiError, errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function sessionDetail(overrides = {}) {
  return {
    id: "s-1",
    script_id: "script-1",
    ordinal: 1,
    status: "in_progress",
    my_character_ids: ["c-nina"],
    my_character_names: ["니나"],
    mode: "read",
    advance: "silence",
    record: true,
    start_line_id: "l-1",
    end_line_id: "l-6",
    range: { start_dialogue_no: 1, end_dialogue_no: 5 },
    my_dialogue_count: 2,
    recorded_line_count: 0,
    elapsed_seconds: 0,
    current_line_id: "l-1",
    progress_seq: 0,
    line_results: [],
    recordings: [],
    started_at: "2026-09-21T03:00:00Z",
    ended_at: null,
    ...overrides,
  };
}

function recordFetch(replies) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    requests.push({
      route: `${init.method ?? "GET"} ${String(url)}`,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      requestId: headers.get("X-Request-Id"),
    });
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    return typeof reply === "function" ? reply() : reply;
  };
  return requests;
}

beforeEach(() => {
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.session: 회차 시작은 POST /v2/reading/scripts/{id}/sessions 이고 내 배역·방식·구간·넘김·녹음과 요청 id 를 싣는다. 같은 요청 id 로 다시 보내면 같은 회차다", async () => {
  const requests = recordFetch([() => jsonResponse(sessionDetail(), 201), () => jsonResponse(sessionDetail(), 200)]);
  const body = { my_character_ids: ["c-nina"], mode: "read", start_line_id: "l-1", end_line_id: "l-6", advance: "silence", record: true };

  const first = await createSession("script-1", body, { requestId: "77777777-7777-4777-8777-777777777777" });
  assert.equal(first.created, true);
  assert.equal(first.session.id, "s-1");
  assert.equal(requests[0].route, "POST /v2/reading/scripts/script-1/sessions");
  assert.deepEqual(requests[0].body, { request_id: "77777777-7777-4777-8777-777777777777", ...body });
  assert.equal(requests[0].requestId, "77777777-7777-4777-8777-777777777777");

  const again = await createSession("script-1", body, { requestId: "77777777-7777-4777-8777-777777777777" });
  assert.equal(again.created, false);
  assert.equal(again.session.id, "s-1");
});

test("reading.session: 회차 목록·상세·삭제 경로", async () => {
  const requests = recordFetch([
    () => jsonResponse({ sessions: [sessionDetail()] }),
    () => jsonResponse(sessionDetail()),
    () => new Response(null, { status: 204 }),
  ]);
  const list = await listSessions("script-1");
  assert.equal(list.sessions.length, 1);
  assert.equal(requests[0].route, "GET /v2/reading/scripts/script-1/sessions");
  const detail = await getSession("s-1");
  assert.equal(detail.id, "s-1");
  assert.equal(requests[1].route, "GET /v2/reading/sessions/s-1");
  await deleteSession("s-1");
  assert.equal(requests[2].route, "DELETE /v2/reading/sessions/s-1");
});

test("reading.session: 진행 저장은 PATCH /v2/reading/sessions/{id}/progress 이고 응답의 현재 값을 돌려준다", async () => {
  const requests = recordFetch([() => jsonResponse({ current_line_id: "l-3", elapsed_seconds: 4, progress_seq: 1, status: "in_progress" })]);
  const body = { progress_seq: 1, current_line_id: "l-3", elapsed_seconds: 4, line_results: [] };
  const answer = await saveProgress("s-1", body);
  assert.equal(requests[0].route, "PATCH /v2/reading/sessions/s-1/progress");
  assert.deepEqual(requests[0].body, body);
  assert.deepEqual(answer, { current_line_id: "l-3", elapsed_seconds: 4, progress_seq: 1, status: "in_progress" });
});

test("reading.session: 회차 오류 코드마다 화면 문구가 있다", () => {
  const message = (code, status = 422) => errorMessage(new ApiError(status, code, code), "기본 문구");
  assert.equal(message("empty_range"), "고른 배역의 대사가 없어요. 다른 배역을 골라 주세요.");
  assert.equal(message("invalid_characters"), "배역 이름이 비어 있거나 다른 배역과 겹쳐요. 이름을 고쳐 주세요.");
  assert.equal(message("invalid_line"), "이 회차의 구간에 없는 줄이에요. 대본을 다시 열어 주세요.");
  assert.equal(message("session_closed", 409), "이미 끝난 회차예요. 상세에서 새로운 연습을 시작해 주세요.");
});
