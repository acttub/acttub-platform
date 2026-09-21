// practice.record·practice.start·practice.resume — 시작하는 길: 영상을 다듬어 보관함에 올리고(확정 = 보관함 저장),
// 그 영상으로 회차를 만든다. 영상 확정과 회차 시작이 분리돼 회차를 만들다 실패해도 영상은 남는다.
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { UploadError } = await import("../src/lib/api/v2/uploads.ts");
const { ApiError } = await import("../src/lib/api/v2/errors.ts");
const { startPractice, startVideoUpload, describeStartFailure } = await import(
  "../src/features/workspace/practice-start.ts"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

const SCENE = { situation: "  면접 첫 인사  ", characterContext: " 긴장한 지원자 ", goal: " 담담하게 말하기 " };
const BLOCKAGE = { blockage_kind: "표현", sub_branch: "몸이 굳어요", blockage_detail: null };
const PRACTICE = { id: "practice-1", root_id: "practice-1", ordinal: 1, stage: "analyzing" };

/** 회차 시작 요청을 받아 적는 fetch. */
function apiStub({ create } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    const headers = new Headers(options?.headers);
    calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null, requestId: headers.get("X-Request-Id") });
    return create ? create(path) : jsonResponse(PRACTICE, 201);
  };
  return calls;
}

function uploaded(overrides = {}) {
  return Promise.resolve({ videoId: "v-1", durationMs: 4_000, compressionRan: true, ...overrides });
}

function startInput(overrides = {}) {
  return { upload: uploaded(), signal: new AbortController().signal, scene: SCENE, blockage: BLOCKAGE, requestId: "req-1", ...overrides };
}

test("practice.start: 확정된 영상으로 회차를 만든다 — 요청 id 를 본문과 헤더에 싣고 상황·인물·목표·막힘을 정리해 보낸다", async () => {
  const calls = apiStub();

  const result = await startPractice(startInput());

  assert.deepEqual(result, { ok: true, practice: PRACTICE, videoId: "v-1", durationMs: 4_000, compressionRan: true });
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [["POST", "/v2/practices"]]);
  assert.equal(calls[0].requestId, "req-1");
  assert.deepEqual(calls[0].body, {
    request_id: "req-1",
    video_id: "v-1",
    scene: { situation: "면접 첫 인사", character: "긴장한 지원자", goal: "담담하게 말하기" },
    blockage: { category: "표현", detail: "몸이 굳어요", note: null },
    client_experience: "three_layers_v1",
  });
});

test("practice.resume: 이어받을 회차를 주면 그 회차의 continue 로 가고, 새 영상이면 video_id 를 싣고 같은 영상이면 싣지 않는다", async () => {
  const calls = apiStub();

  await startPractice(startInput({ continueFromId: "practice-0" }));
  assert.equal(calls[0].path, "/v2/practices/practice-0/continue");
  assert.equal(calls[0].body.video_id, "v-1");

  await startPractice(startInput({ continueFromId: "practice-0", reuseVideo: true }));
  assert.equal("video_id" in calls[1].body, false);
});

test("practice.resume: 묶음에 진행 중 회차가 있으면(409 practice_in_progress) 그 사실을 결과로 돌려준다", async () => {
  apiStub({ create: () => jsonResponse({ detail: "practice_in_progress" }, 409) });
  const result = await startPractice(startInput({ continueFromId: "practice-0" }));
  assert.equal(result.ok, false);
  assert.equal(result.inProgress, true);
  assert.equal(result.stage, "session_create");
  assert.equal(result.message, "진행 중인 회차가 있어요. 그 회차로 돌아가요.");
});

test("practice.start: 게스트의 하루 4번째 시작(429)은 회차가 생기지 않고 안내 문구가 온다", async () => {
  apiStub({ create: () => jsonResponse({ detail: "guest_daily_analysis_limit" }, 429) });
  const result = await startPractice(startInput());
  assert.equal(result.ok, false);
  assert.equal(result.inProgress, false);
  assert.equal(result.message, "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요.");
});

test("압축을 안 돌린 업로드는 그 사실을 그대로 돌려준다", async () => {
  apiStub();
  const result = await startPractice(startInput({ upload: uploaded({ compressionRan: false }) }));
  assert.equal(result.ok, true);
  assert.equal(result.compressionRan, false);
});

test("업로드가 UploadError 로 엎어지면 그 예외가 말하는 자리를 그대로 쓴다", async () => {
  apiStub();
  const result = await startPractice(startInput({ upload: Promise.reject(new UploadError("put", "S3 가 거부했어요")) }));
  assert.equal(result.ok, false);
  assert.equal(result.stage, "put");
  assert.equal(result.message, "S3 가 거부했어요");
});

test("업로드에 닿기 전 실패(압축·길이 검사)는 preflight 로 센다", async () => {
  apiStub();
  const result = await startPractice(startInput({ upload: Promise.reject(new Error("영상이 너무 길어요(5분 이내).")) }));
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
});

test("🔥 회차 생성 실패는 preflight 가 아니라 session_create 로 센다", async () => {
  apiStub({ create: () => jsonResponse({ detail: "video_not_ready" }, 422) });
  const result = await startPractice(startInput());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "session_create");
  assert.equal(result.message, "이 영상은 아직 쓸 수 없어요. 다른 영상을 골라 주세요.");
});

test("배우가 그만둔 것은 aborted 로 갈라 오류를 띄우지 않게 한다", async () => {
  const failure = describeStartFailure("preflight", new DOMException("취소", "AbortError"));
  assert.equal(failure.aborted, true);
  assert.equal(failure.inProgress, false);
  const wrapped = describeStartFailure("preflight", new UploadError("put", "취소", new DOMException("취소", "AbortError")));
  assert.equal(wrapped.aborted, true);
  assert.equal(describeStartFailure("session_create", new ApiError(409, "practice_in_progress", "practice_in_progress")).inProgress, true);
});

test("Error 가 아닌 것이 던져지거나 할 말이 비어 있어도 화면이 빈 줄을 그리지 않는다", () => {
  assert.equal(describeStartFailure("preflight", "boom").message, "문제가 생겼어요. 다시 시도해 주세요.");
  assert.equal(describeStartFailure("preflight", new Error("")).message, "문제가 생겼어요. 다시 시도해 주세요.");
});

// --- startVideoUpload ---

/** prepareVideoUpload 자리에 끼우는 가짜. 압축 진행률을 부를지 고를 수 있다. */
function fakePrepare({ compress = null, durationMs = 7_000, compressMs = 1_500 } = {}) {
  return async (file, options) => {
    if (compress !== null) options.onCompressionProgress(compress);
    return { file, durationMs, wasCompressed: compress !== null, compressMs };
  };
}

/** S3 PUT 자리. 브라우저 XHR 대신 진행률만 흘려 준다. */
function fakeUploader(percents = [40, 100]) {
  return async ({ onProgress }) => {
    for (const percent of percents) onProgress?.({ percent });
  };
}

/** 자리 받기·마무리를 받아 적는 fetch. 마무리가 곧 보관함 저장이다. */
function uploadStub() {
  const seen = { calls: [] };
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    seen.calls.push({ path, requestId: new Headers(init?.headers).get("X-Request-Id"), body: init?.body ? JSON.parse(init.body) : null });
    if (path === "/v2/videos/intents") {
      return jsonResponse({ intent_id: "intent-7", upload_url: "https://s3.example/upload", expires_at: "2026-07-18T00:00:00Z" }, 201);
    }
    seen.finalized = path;
    return jsonResponse({ id: "v-7", duration_ms: 7_000, byte_size: 5, content_type: "video/mp4", favorite: false, purged_at: null, created_at: "", usage: { practice_count: 0, entry_count: 0 }, playback_url: null, playback_expires_at: null }, 201);
  };
  return seen;
}

test("practice.record: 업로드를 띄우면 진행률을 먼저 되돌리고 압축·업로드를 차례로 알리며, 끝나면 보관함에 확정된 영상 id 를 돌려준다", async () => {
  const seen = uploadStub();
  const events = [];
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  const pending = startVideoUpload(file, { onProgress: (event) => events.push(event), prepare: fakePrepare({ compress: 0.5 }), uploader: fakeUploader(), requestId: "up-1" });

  assert.deepEqual(events[0], { type: "reset" });
  assert.deepEqual(await pending.promise, { videoId: "v-7", durationMs: 7_000, compressionRan: true });
  assert.deepEqual(events[1], { type: "compress", ratio: 0.5 });
  assert.equal(events.at(-1).type, "upload");
  assert.equal(events.at(-1).compressed, true);
  // 마무리(보관함 저장)까지 한다 — 회차를 만들지 않아도 영상은 보관함에 남는다.
  assert.equal(seen.finalized, "/v2/videos/intents/intent-7/complete");
  assert.deepEqual(seen.calls.map((c) => c.requestId), ["up-1", "up-1"]);
});

test("압축이 한 번도 안 돌면 업로드 구간은 0 부터 그린다", async () => {
  uploadStub();
  const events = [];
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });
  const pending = startVideoUpload(file, { onProgress: (event) => events.push(event), prepare: fakePrepare(), uploader: fakeUploader() });
  assert.equal((await pending.promise).compressionRan, false);
  assert.equal(events.some((event) => event.type === "compress"), false);
  assert.equal(events.at(-1).compressed, false);
});

test("시작 전에 엎어져도 아무도 안 받는 거절로 남지 않는다", async () => {
  uploadStub();
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });
  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: async () => {
      throw new Error("영상은 5분 이하여야 해요.");
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(pending.promise, /5분 이하/);
});

test("업로드를 끊으면 압축과 S3 PUT 양쪽이 함께 끊긴다", async () => {
  uploadStub();
  const seen = [];
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });
  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: async (_file, options) => {
      seen.push(["prepare", options.signal]);
      return { file, durationMs: 1_000, wasCompressed: false, compressMs: 0 };
    },
    uploader: async ({ signal }) => {
      seen.push(["put", signal]);
    },
  });
  await pending.promise;
  assert.equal(seen.length, 2);
  assert.equal(seen[0][1], pending.controller.signal);
  assert.equal(seen[1][1], pending.controller.signal);
});

test("업로드마다 제 신호를 들고 나오고 그 파일을 기억한다", () => {
  uploadStub();
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });
  const pending = startVideoUpload(file, { onProgress: () => {}, prepare: fakePrepare(), uploader: fakeUploader() });
  assert.equal(pending.file, file);
  assert.ok(pending.controller instanceof AbortController);
  pending.controller.abort();
  assert.equal(pending.controller.signal.aborted, true);
});
