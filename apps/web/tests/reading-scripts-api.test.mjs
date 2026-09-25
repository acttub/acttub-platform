// reading.script — 대본 서버 클라이언트. POST(요청 id 멱등·재시도)·GET 목록·상세·PATCH·DELETE 와
// 게스트 동의 흐름(403 consent_required → 시트 → 같은 요청 재전송), 한도·오류 코드의 화면 문구.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createScript, deleteScript, getScript, listScripts, updateScript } = await import(
  "../src/lib/api/v2/reading-scripts.ts"
);
const { registerConsentPrompt } = await import("../src/lib/api/v2/consent-prompt.ts");
const { ApiError, errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
let unregisterPrompt = () => {};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function consentDocument(type) {
  return {
    id: `${type}-document`,
    type,
    version: "2026-10-01",
    title: `${type} 문서`,
    body: `${type} 전문`,
    required: true,
    published_at: "2026-10-01T00:00:00.000000Z",
  };
}

function consentRequired(...types) {
  return jsonResponse(
    { detail: "consent_required", pending_consents: types.map((type) => consentDocument(type)) },
    403,
  );
}

const REQUEST = {
  title: "옥상, 밤",
  source: "paste",
  raw_text: "윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.",
  characters: [{ name: "윤서" }, { name: "태오" }],
  lines: [
    { ordinal: 1, kind: "dialogue", character_index: 0, text: "여기 있을 줄 알았어." },
    { ordinal: 2, kind: "dialogue", character_index: 1, text: "어떻게 알았어." },
  ],
};

function scriptDetail(overrides = {}) {
  return {
    id: "script-1",
    title: "옥상, 밤",
    source: "paste",
    raw_text: REQUEST.raw_text,
    characters: [
      { id: "c-1", name: "윤서", order: 0, voice_preset: null, dialogue_count: 1 },
      { id: "c-2", name: "태오", order: 1, voice_preset: null, dialogue_count: 1 },
    ],
    lines: [
      { id: "l-1", ordinal: 1, kind: "dialogue", character_id: "c-1", text: "여기 있을 줄 알았어.", dialogue_no: 1 },
      { id: "l-2", ordinal: 2, kind: "dialogue", character_id: "c-2", text: "어떻게 알았어.", dialogue_no: 2 },
    ],
    recording_count: 0,
    open_session_id: null,
    last_session: null,
    created_at: "2026-09-21T03:00:00Z",
    updated_at: "2026-09-21T03:00:00Z",
    ...overrides,
  };
}

/** 온 요청을 적어 두고, 순서대로 답한다. */
function recordFetch(replies) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    requests.push({
      route: `${init.method ?? "GET"} ${String(url)}`,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      requestId: headers.get("X-Request-Id"),
      authorization: headers.get("Authorization"),
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
  unregisterPrompt();
  unregisterPrompt = () => {};
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.script: 저장은 POST /v2/reading/scripts 한 요청이고 기기가 만든 요청 id 를 본문과 헤더에 함께 싣는다", async () => {
  const requests = recordFetch([() => jsonResponse(scriptDetail(), 201)]);

  const result = await createScript(REQUEST, { requestId: "11111111-1111-4111-8111-111111111111" });

  assert.equal(result.created, true);
  assert.equal(result.script.id, "script-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, "POST /v2/reading/scripts");
  assert.equal(requests[0].requestId, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(requests[0].body, { request_id: "11111111-1111-4111-8111-111111111111", ...REQUEST });
  assert.equal(requests[0].authorization, "Bearer guest-access");
});

test("reading.script: 같은 요청 id·같은 본문의 재전송에 서버가 먼저 만든 대본(200)을 돌려주면 새로 만든 것이 아니라고 알린다", async () => {
  recordFetch([() => jsonResponse(scriptDetail(), 200)]);

  const result = await createScript(REQUEST, { requestId: "11111111-1111-4111-8111-111111111111" });

  assert.equal(result.created, false);
  assert.equal(result.script.id, "script-1");
});

test("reading.script: 저장 도중 연결이 끊기면 같은 요청 id·같은 본문으로 다시 보낸다", async () => {
  const requests = recordFetch([
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => jsonResponse(scriptDetail(), 201),
  ]);

  const result = await createScript(REQUEST, { requestId: "22222222-2222-4222-8222-222222222222" });

  assert.equal(result.created, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.deepEqual(requests[0].body, requests[1].body);
});

test("reading.script: 새 게스트의 첫 등록에 403 consent_required 가 오면 서버가 준 문서(이용약관·개인정보 수집·이용 동의 둘)만으로 시트를 띄우고 결정 뒤 같은 요청을 다시 보낸다", async () => {
  const requests = recordFetch([() => consentRequired("terms", "privacy"), () => jsonResponse(scriptDetail(), 201)]);
  const prompted = [];
  unregisterPrompt = registerConsentPrompt(async (documents) => {
    prompted.push(documents.map((document) => document.type));
    return "decided";
  });

  const result = await createScript(REQUEST, { requestId: "33333333-3333-4333-8333-333333333333" });

  assert.equal(result.created, true);
  assert.deepEqual(prompted, [["terms", "privacy"]]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

test("reading.script: 동의 시트를 닫으면 등록은 403 consent_required 로 끝나고 안내 문구를 준다", async () => {
  recordFetch([() => consentRequired("terms", "privacy")]);
  unregisterPrompt = registerConsentPrompt(async () => "dismissed");

  let caught;
  try {
    await createScript(REQUEST, { requestId: "44444444-4444-4444-8444-444444444444" });
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.status, 403);
  assert.equal(caught?.code, "consent_required");
  assert.equal(errorMessage(caught, "기본 문구"), "동의해야 계속할 수 있어요. 다시 시도하면 동의 문서를 볼 수 있어요.");
});

test("reading.script: 목록은 GET /v2/reading/scripts 이고 검색어는 q 로 싣는다", async () => {
  const list = { scripts: [], total_count: 0, in_progress_count: 0 };
  const requests = recordFetch([() => jsonResponse(list)]);

  assert.deepEqual(await listScripts(), list);
  assert.equal(requests[0].route, "GET /v2/reading/scripts");

  await listScripts("니나 역");
  assert.equal(requests[1].route, "GET /v2/reading/scripts?q=%EB%8B%88%EB%82%98%20%EC%97%AD");
});

test("reading.script: 게스트가 없으면 목록 조회는 서버에 가지 않고 게스트도 만들지 않는다", async () => {
  clearTokens();
  const requests = recordFetch([() => jsonResponse({ scripts: [], total_count: 0, in_progress_count: 0 })]);

  await assert.rejects(listScripts(), (error) => error instanceof ApiError && error.code === "guest_session_required");
  assert.equal(requests.length, 0);
});

test("reading.script: 상세·수정·삭제는 대본 id 경로를 쓰고 수정은 제목·배역 이름만 보낸다", async () => {
  const requests = recordFetch([
    () => jsonResponse(scriptDetail()),
    () => jsonResponse(scriptDetail({ title: "옥상" })),
    () => new Response(null, { status: 204 }),
  ]);

  const detail = await getScript("script-1");
  assert.equal(detail.id, "script-1");
  assert.equal(requests[0].route, "GET /v2/reading/scripts/script-1");

  const updated = await updateScript("script-1", { title: "옥상", characters: [{ id: "c-1", name: "윤서 (나)" }] });
  assert.equal(updated.title, "옥상");
  assert.equal(requests[1].route, "PATCH /v2/reading/scripts/script-1");
  assert.deepEqual(requests[1].body, { title: "옥상", characters: [{ id: "c-1", name: "윤서 (나)" }] });

  await deleteScript("script-1");
  assert.equal(requests[2].route, "DELETE /v2/reading/scripts/script-1");
  assert.equal(requests[2].body, undefined);
});

test("reading.script: 한도·오류 코드마다 화면 문구가 있다", () => {
  const message = (code, status = 422) => errorMessage(new ApiError(status, code, code), "기본 문구");
  assert.equal(message("script_too_long"), "대본이 너무 길어요. 원문 100,000자·줄 3,000개·배역 50명까지 저장할 수 있어요.");
  assert.equal(message("script_limit"), "대본은 20개까지 저장할 수 있어요. 안 쓰는 대본을 지우면 다시 저장할 수 있어요.");
  assert.equal(message("no_characters"), "배역이 하나도 없어요. 배역 이름을 적어 주세요.");
  assert.equal(message("invalid_characters"), "배역 이름이 비어 있거나 다른 배역과 겹쳐요. 이름을 고쳐 주세요.");
  assert.equal(message("request_fingerprint_mismatch"), "같은 요청으로 다른 대본이 저장돼 있어요. 대본을 다시 넣어 주세요.");
  // 404 는 리소스 존재 여부를 드러내지 않는 중립 카피 — 부르는 자리의 문구다.
  assert.equal(message("not_found", 404), "기본 문구");
});
