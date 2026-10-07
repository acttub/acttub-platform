// reading.script — 대본 넣기 서버 클라이언트. 나누기 맡기기(요청 id 멱등·재시도·게스트 동의 시트)·작업 조회·원본 파일 올리기.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { completeUpload, createUpload, getImport, startImport } = await import("../src/lib/api/v2/reading-imports.ts");
const { registerConsentPrompt } = await import("../src/lib/api/v2/consent-prompt.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
let unregisterPrompt = () => {};

function jsonResponse(payload, status = 200) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function consentRequired(...types) {
  const pending = types.map((type) => ({
    id: `${type}-document`,
    type,
    version: "2026-10-01",
    title: `${type} 문서`,
    body: `${type} 전문`,
    required: true,
    published_at: "2026-10-01T00:00:00.000000Z",
  }));
  return jsonResponse({ detail: "consent_required", pending_consents: pending }, 403);
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
    });
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    return typeof reply === "function" ? reply() : reply;
  };
  return requests;
}

const BODY = { raw_text: "윤서: 안녕.\n태오: 응.", source: "paste", allow_duplicate: false, skip_script_check: false };
const TICKET = { import_id: "import-1", duplicate_script_id: null };

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

test("reading.script: 나누기는 POST /v2/reading/imports 한 요청이고 요청 id 를 본문과 헤더에 함께 싣는다", async () => {
  const requests = recordFetch([() => jsonResponse(TICKET, 202)]);

  const ticket = await startImport(BODY, "11111111-1111-4111-8111-111111111111");

  assert.deepEqual(ticket, TICKET);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, "POST /v2/reading/imports");
  assert.equal(requests[0].requestId, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(requests[0].body, { request_id: "11111111-1111-4111-8111-111111111111", ...BODY });
});

test("reading.script: 맡기는 도중 연결이 끊기면 같은 요청 id·같은 본문으로 다시 보낸다", async () => {
  const requests = recordFetch([
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => jsonResponse(TICKET, 202),
  ]);

  await startImport(BODY, "22222222-2222-4222-8222-222222222222");

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

test("reading.script: 하루 한도 429 는 기다렸다 다시 보내지 않고 바로 돌려준다", async () => {
  const requests = recordFetch([() => jsonResponse({ detail: "script_split_daily_limit" }, 429)]);

  await assert.rejects(startImport(BODY, "33333333-3333-4333-8333-333333333333"), (error) => error.status === 429 && error.code === "script_split_daily_limit");
  assert.equal(requests.length, 1);
});

test("reading.script: 새 게스트의 첫 넣기에 403 consent_required 가 오면 서버가 준 문서로 시트를 띄우고 결정 뒤 같은 요청을 다시 보낸다", async () => {
  const requests = recordFetch([() => consentRequired("terms", "privacy"), () => jsonResponse(TICKET, 202)]);
  const prompted = [];
  unregisterPrompt = registerConsentPrompt(async (documents) => {
    prompted.push(documents.map((document) => document.type));
    return "decided";
  });

  const ticket = await startImport(BODY, "44444444-4444-4444-8444-444444444444");

  assert.deepEqual(ticket, TICKET);
  assert.deepEqual(prompted, [["terms", "privacy"]]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

test("reading.script: 작업 조회와 파일 올릴 자리·글자 뽑기는 각자의 경로로 간다", async () => {
  const job = { id: "import-1", status: "running", progress: { done_lines: 3, total_lines: 9 }, script_id: null, failure: null };
  const upload = { upload_id: "upload-1", upload_url: "https://s3.example/put", content_type: "application/octet-stream", expires_at: "2026-10-06T00:15:00Z" };
  const requests = recordFetch([() => jsonResponse(job), () => jsonResponse(upload, 201), () => new Response(null, { status: 204 })]);

  assert.deepEqual(await getImport("import-1"), job);
  assert.deepEqual(await createUpload(new File([new Uint8Array(12)], "갈매기.hwp")), upload);
  await completeUpload("upload-1");

  assert.deepEqual(
    requests.map((r) => [r.route, r.body]),
    [
      ["GET /v2/reading/imports/import-1", undefined],
      ["POST /v2/reading/uploads", { file_name: "갈매기.hwp", byte_size: 12 }],
      ["POST /v2/reading/uploads/upload-1/complete", undefined],
    ],
  );
});
