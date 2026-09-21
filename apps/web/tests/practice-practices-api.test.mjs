// practice.start·resume·analyze — 회차 클라이언트: 시작(request_id 본문+헤더, video_id), 이어하기(같은 영상·새 영상), 묶음 목록,
// 상태 폴링(10초), 그만두기, 묶음 숨김·즐겨찾기, 409 practice_in_progress 와 게스트 한도 문구.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const {
  cancelPractice,
  continuePractice,
  createPractice,
  getPractice,
  getPracticeStatus,
  listPracticeGroups,
  PRACTICE_POLL_INTERVAL_MS,
  pollPracticeUntilSettled,
  reanalyzeSession,
  updatePracticeGroup,
} = await import("../src/lib/api/v2/practices.ts");
const { ApiError, errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function practice(overrides = {}) {
  return {
    id: "p-1",
    root_id: "p-1",
    ordinal: 1,
    stage: "analyzing",
    experience_version: "legacy",
    video: { id: "v-1", playback_url: null, playback_expires_at: null, purged_at: null, duration_ms: 4200 },
    scene: { situation: "", character: "", goal: "" },
    blockage: { category: "그 외", detail: "그 외", note: null },
    job: { id: "j-1", status: "pending", failure_reason: null },
    analysis: null,
    conversation: null,
    note: null,
    created_at: "2026-09-21T03:00:00Z",
    updated_at: "2026-09-21T03:00:00Z",
    ...overrides,
  };
}

function recordFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), "http://web.test");
    const path = u.pathname + u.search;
    const headers = new Headers(init.headers);
    calls.push({ route: `${init.method ?? "GET"} ${path}`, body: init.body ? JSON.parse(init.body) : undefined, requestId: headers.get("X-Request-Id") });
    const reply = routes[`${init.method ?? "GET"} ${path}`];
    if (!reply) throw new Error(`예상하지 못한 요청: ${init.method ?? "GET"} ${path}`);
    return reply(calls.at(-1), calls.length);
  };
  return calls;
}

beforeEach(() => {
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

const START = {
  video_id: "v-1",
  scene: { situation: "  면접 첫 인사 ", character: "", goal: "" },
  blockage: { category: "표현", detail: "감정", note: null },
  client_experience: "three_layers_v1",
};

test("practice.start: 시작은 POST /v2/practices 에 request_id(본문+헤더)·video_id·장면·막힘·경험 판을 싣고, 같은 요청 id 재전송은 같은 회차다", async () => {
  const calls = recordFetch({ "POST /v2/practices": (_c, n) => jsonResponse(practice(), n === 1 ? 201 : 200) });
  const first = await createPractice(START, { requestId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(first.created, true);
  assert.equal(first.practice.id, "p-1");
  assert.equal(calls[0].requestId, "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(calls[0].body, { request_id: "22222222-2222-4222-8222-222222222222", ...START });
  const again = await createPractice(START, { requestId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(again.created, false);
});

test("practice.resume: 이어하기는 POST /v2/practices/{id}/continue 이고 같은 영상이면 video_id 를 싣지 않는다", async () => {
  const calls = recordFetch({ "POST /v2/practices/p-1/continue": () => jsonResponse(practice({ id: "p-2", ordinal: 2 }), 201) });
  const same = await continuePractice("p-1", { scene: START.scene, blockage: START.blockage, client_experience: "legacy" }, { requestId: "r-1" });
  assert.equal(same.practice.ordinal, 2);
  assert.equal("video_id" in calls[0].body, false);
  await continuePractice("p-1", { video_id: "v-9", scene: START.scene, blockage: START.blockage, client_experience: "legacy" }, { requestId: "r-2" });
  assert.equal(calls[1].body.video_id, "v-9");
});

test("practice.library: 묶음 목록은 필터를 싣고, 묶음 숨김·즐겨찾기는 PATCH /v2/practices/{root_id}/group 이다", async () => {
  const group = { root_id: "p-1", title: "면접 첫 인사", ordinal_count: 2, last_conversation_at: null, tags: [], favorite: false, hidden_at: null, in_progress_practice_id: null, practices: [] };
  const calls = recordFetch({
    "GET /v2/practices?filter=recent30": () => jsonResponse({ groups: [group] }),
    "PATCH /v2/practices/p-1/group": (c) => jsonResponse({ ...group, hidden_at: c.body.hidden ? "2026-09-21T04:00:00Z" : null }),
  });
  const list = await listPracticeGroups("recent30");
  assert.equal(list.groups[0].root_id, "p-1");
  const hidden = await updatePracticeGroup("p-1", { hidden: true });
  assert.equal(hidden.hidden_at, "2026-09-21T04:00:00Z");
  assert.deepEqual(calls[1].body, { hidden: true });
});

test("practice.analyze: 상태는 10초 간격으로 읽고 succeeded·failed 에서 멈추며 마지막에 상세를 받는다; 그만두기는 POST cancel 이다", async () => {
  assert.equal(PRACTICE_POLL_INTERVAL_MS, 10_000);
  const statuses = [
    { stage: "analyzing", job: { status: "pending", failure_reason: null }, analysis: null },
    { stage: "analyzing", job: { status: "running", failure_reason: null }, analysis: null },
    { stage: "conversing", job: { status: "succeeded", failure_reason: null }, analysis: { status: "partial" } },
  ];
  let i = 0;
  const calls = recordFetch({
    "GET /v2/practices/p-1/status": () => jsonResponse(statuses[Math.min(i++, statuses.length - 1)]),
    "GET /v2/practices/p-1": () => jsonResponse(practice({ stage: "conversing", job: { id: "j-1", status: "succeeded", failure_reason: null }, analysis: { status: "partial", summary: null } })),
    "POST /v2/practices/p-1/cancel": () => jsonResponse({ job: { status: "failed", failure_reason: "cancelled" } }),
  });
  const seen = [];
  const settled = await pollPracticeUntilSettled("p-1", { intervalMs: 1, onStatus: (s) => seen.push(s.job.status) });
  assert.deepEqual(seen, ["pending", "running", "succeeded"]);
  assert.equal(settled.analysis.status, "partial");
  assert.equal(calls.filter((c) => c.route.endsWith("/status")).length, 3);
  const cancelled = await cancelPractice("p-1");
  assert.equal(cancelled.job.failure_reason, "cancelled");
  const status = await getPracticeStatus("p-1");
  assert.equal(status.job.status, "succeeded");
  const detail = await getPractice("p-1");
  assert.equal(detail.id, "p-1");
});

test("practice.analyze: 명시적 재시도는 POST /v2/practices/{id}/retry 이고 새 작업과 함께 analyzing 으로 돌아간다", async () => {
  const calls = recordFetch({ "POST /v2/practices/p-1/retry": () => jsonResponse(practice({ stage: "analyzing", job: { id: "j-2", status: "pending", failure_reason: null } })) });
  const retried = await reanalyzeSession("p-1");
  assert.equal(retried.job.id, "j-2");
  assert.equal(calls[0].route, "POST /v2/practices/p-1/retry");
});

test("practice.start·resume·analyze: 회차 오류 코드마다 화면 문구가 있다", () => {
  const message = (code, status = 422) => errorMessage(new ApiError(status, code, code), "기본 문구");
  assert.equal(message("practice_in_progress", 409), "진행 중인 회차가 있어요. 그 회차로 돌아가요.");
  assert.equal(message("analysis_not_ready", 409), "영상을 분석해야 대화를 시작할 수 있어요.");
  assert.equal(message("guest_daily_analysis_limit", 429), "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요.");
});
