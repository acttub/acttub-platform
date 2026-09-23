// reading.recording — 녹음 올리기(multipart)·삭제 클라이언트와 문구. 공용 클라이언트가 FormData 본문을 그대로 보내는지도 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { deleteRecording, uploadRecording } = await import("../src/lib/api/v2/reading-recordings.ts");
const { listMemorization, setMemorization } = await import("../src/lib/api/v2/reading-memorization.ts");
const { ApiError, errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function recording(overrides = {}) {
  return {
    id: "r-1",
    line_id: "l-3",
    attempt_no: 1,
    duration_ms: 4200,
    content_type: "audio/mp4",
    byte_size: 12345,
    transcript: null,
    transcript_source: "none",
    matched: null,
    playback_url: null,
    playback_expires_at: null,
    ...overrides,
  };
}

function recordFetch(replies) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    requests.push({ route: `${init.method ?? "GET"} ${String(url)}`, body: init.body, headers });
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

test("공용 클라이언트는 FormData 본문을 그대로 보내고 Content-Type 을 JSON 으로 덮지 않는다", async () => {
  const requests = recordFetch([() => jsonResponse({ ok: true }, 201)]);
  const form = new FormData();
  form.set("a", "1");
  await apiFetch("/v2/anything", { method: "POST", body: form });
  assert.equal(requests[0].body instanceof FormData, true);
  assert.equal(requests[0].headers.has("Content-Type"), false);
});

test("reading.recording: 올리기는 multipart 한 요청으로 request_id·line_id·attempt_no·음성 파일·duration_ms·전사와 대조를 싣고 content_type 을 파일 형식 그대로 보낸다", async () => {
  const requests = recordFetch([() => jsonResponse(recording(), 201)]);
  const blob = new Blob([new Uint8Array(10)], { type: "audio/webm;codecs=opus" });

  const result = await uploadRecording("s-1", {
    requestId: "88888888-8888-4888-8888-888888888888",
    lineId: "l-3",
    attemptNo: 2,
    blob,
    contentType: "audio/webm;codecs=opus",
    durationMs: 4200,
    transcript: "여기 있을 줄 알았어",
    transcriptSource: "stt",
    matched: true,
  });

  assert.equal(result.created, true);
  assert.equal(result.recording.id, "r-1");
  assert.equal(requests[0].route, "POST /v2/reading/sessions/s-1/recordings");
  assert.equal(requests[0].headers.get("X-Request-Id"), "88888888-8888-4888-8888-888888888888");
  const form = requests[0].body;
  assert.equal(form instanceof FormData, true);
  assert.equal(form.get("request_id"), "88888888-8888-4888-8888-888888888888");
  assert.equal(form.get("line_id"), "l-3");
  assert.equal(form.get("attempt_no"), "2");
  assert.equal(form.get("duration_ms"), "4200");
  assert.equal(form.get("transcript"), "여기 있을 줄 알았어");
  assert.equal(form.get("transcript_source"), "stt");
  assert.equal(form.get("matched"), "true");
  const audio = form.get("audio");
  assert.equal(audio instanceof Blob, true);
  assert.equal(audio.type, "audio/webm;codecs=opus");
  assert.equal(audio.name, "line.webm");
});

test("reading.recording: STT 없이 올리면 transcript_source none 이고 transcript·matched 는 싣지 않는다; 같은 요청 id 재전송(200)은 새 행이 아니다", async () => {
  const requests = recordFetch([() => jsonResponse(recording(), 200)]);
  const result = await uploadRecording("s-1", {
    requestId: "99999999-9999-4999-8999-999999999999",
    lineId: "l-3",
    attemptNo: 1,
    blob: new Blob([new Uint8Array(4)], { type: "audio/mp4" }),
    contentType: "audio/mp4",
    durationMs: 1000,
    transcript: null,
    transcriptSource: "none",
    matched: null,
  });
  assert.equal(result.created, false);
  const form = requests[0].body;
  assert.equal(form.get("transcript_source"), "none");
  assert.equal(form.has("transcript"), false);
  assert.equal(form.has("matched"), false);
  assert.equal(form.get("audio").name, "line.m4a");
});

test("reading.recording: 개별 녹음 삭제 경로", async () => {
  const requests = recordFetch([() => new Response(null, { status: 204 })]);
  await deleteRecording("r-1");
  assert.equal(requests[0].route, "DELETE /v2/reading/recordings/r-1");
});

test("reading.memorization: 조회는 대본 단위 GET, 갱신은 줄마다 PUT {status}", async () => {
  const requests = recordFetch([
    () => jsonResponse([{ line_id: "l-1", status: "memorized", updated_at: "2026-09-21T03:00:00Z" }]),
    () => jsonResponse({ line_id: "l-2", status: "not_yet", updated_at: "2026-09-21T03:01:00Z" }),
  ]);
  const list = await listMemorization("script-1");
  assert.equal(requests[0].route, "GET /v2/reading/scripts/script-1/memorization");
  assert.deepEqual(list, [{ line_id: "l-1", status: "memorized", updated_at: "2026-09-21T03:00:00Z" }]);
  const entry = await setMemorization("l-2", "not_yet");
  assert.equal(requests[1].route, "PUT /v2/reading/lines/l-2/memorization");
  assert.deepEqual(JSON.parse(requests[1].body), { status: "not_yet" });
  assert.equal(entry.status, "not_yet");
});

test("reading.recording: 녹음 오류 코드마다 화면 문구가 있다", () => {
  const message = (code, status = 422) => errorMessage(new ApiError(status, code, code), "기본 문구");
  assert.equal(message("recording_too_long"), "이 줄 녹음은 너무 길어 저장하지 않았어요.");
  assert.equal(message("recording_quota"), "녹음 저장 공간이 가득 찼어요. 지난 녹음을 지우면 다시 저장할 수 있어요.");
  assert.equal(message("audio_conversion_failed", 503), "녹음을 저장하는 중이에요. 잠시 뒤 다시 시도해요.");
});
