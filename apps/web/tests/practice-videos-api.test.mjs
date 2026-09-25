// practice.record·practice.library — 영상 보관함 클라이언트: 올리기 세 단계(자리 받기·올리기·마무리 = 보관함 저장),
// 목록 필터, 상세(서명 URL·사용처), 즐겨찾기, 삭제(video_in_use), 파일만 파기, 오류 문구.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { deleteVideo, getVideo, listVideos, purgeVideoFile, setVideoFavorite, uploadLibraryVideo } = await import(
  "../src/lib/api/v2/videos.ts"
);
const { ApiError, errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function video(overrides = {}) {
  return {
    id: "v-1",
    duration_ms: 4200,
    byte_size: 1234,
    content_type: "video/mp4",
    favorite: false,
    purged_at: null,
    created_at: "2026-09-21T03:00:00Z",
    usage: { practice_count: 0, entry_count: 0 },
    playback_url: null,
    playback_expires_at: null,
    ...overrides,
  };
}

function recordFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), "http://web.test").pathname + new URL(String(url), "http://web.test").search;
    const headers = new Headers(init.headers);
    calls.push({ route: `${init.method ?? "GET"} ${path}`, body: init.body ? JSON.parse(init.body) : undefined, requestId: headers.get("X-Request-Id") });
    const reply = routes[`${init.method ?? "GET"} ${path}`] ?? routes[path];
    if (!reply) throw new Error(`예상하지 못한 요청: ${init.method ?? "GET"} ${path}`);
    return reply(calls.at(-1));
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

test("practice.record: 올리기는 자리 받기 → 올리기 → 마무리 순이고 마무리가 영상(보관함 저장)을 돌려준다. 같은 요청 id 재전송은 같은 영상이다", async () => {
  const puts = [];
  const calls = recordFetch({
    "POST /v2/videos/intents": () => jsonResponse({ intent_id: "i-1", upload_url: "https://s3/put", expires_at: "2026-09-21T03:30:00Z" }, 201),
    "POST /v2/videos/intents/i-1/complete": () => jsonResponse(video(), 201),
  });
  const file = new File([new Uint8Array(10)], "take.mp4", { type: "video/mp4" });
  const result = await uploadLibraryVideo(file, {
    durationMs: 4200,
    requestId: "11111111-1111-4111-8111-111111111111",
    uploader: async ({ url, contentType }) => void puts.push([url, contentType]),
  });
  assert.equal(result.id, "v-1");
  assert.deepEqual(puts, [["https://s3/put", "video/mp4"]]);
  assert.equal(calls[0].route, "POST /v2/videos/intents");
  assert.deepEqual(calls[0].body, { request_id: "11111111-1111-4111-8111-111111111111", content_type: "video/mp4", byte_size: 10, duration_ms: 4200 });
  assert.equal(calls[0].requestId, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[1].route, "POST /v2/videos/intents/i-1/complete");
  assert.equal(calls[1].requestId, "11111111-1111-4111-8111-111111111111");
});

test("practice.record: 100MiB 초과·5분 초과·영상이 아닌 파일은 자리를 받기 전에 거른다", async () => {
  const calls = recordFetch({});
  const big = new File([new Uint8Array(1)], "big.mp4", { type: "video/mp4" });
  Object.defineProperty(big, "size", { value: 100 * 1024 * 1024 + 1 });
  await assert.rejects(uploadLibraryVideo(big, { durationMs: 1000, requestId: "r", uploader: async () => {} }), (e) => /100MB/.test(e.message));
  const long = new File([new Uint8Array(1)], "long.mp4", { type: "video/mp4" });
  await assert.rejects(uploadLibraryVideo(long, { durationMs: 300_001, requestId: "r", uploader: async () => {} }), (e) => /5분/.test(e.message));
  const text = new File(["x"], "note.txt", { type: "text/plain" });
  await assert.rejects(uploadLibraryVideo(text, { durationMs: 1000, requestId: "r", uploader: async () => {} }), (e) => /동영상/.test(e.message));
  assert.equal(calls.length, 0);
});

test("practice.library: 목록은 필터(all·recent7·favorite)를 싣고, 상세·즐겨찾기·삭제·파일만 파기의 경로가 맞다", async () => {
  const calls = recordFetch({
    "GET /v2/videos?filter=recent7": () => jsonResponse({ videos: [video()], next_cursor: null }),
    "GET /v2/videos/v-1": () => jsonResponse(video({ playback_url: "https://cdn/v-1", playback_expires_at: "2026-09-21T03:10:00Z", usage: { practice_count: 2, entry_count: 0 } })),
    "PATCH /v2/videos/v-1": () => jsonResponse(video({ favorite: true })),
    "DELETE /v2/videos/v-1": () => new Response(null, { status: 204 }),
    "POST /v2/videos/v-1/purge-file": () => jsonResponse(video({ purged_at: "2026-09-21T04:00:00Z" })),
  });
  const list = await listVideos("recent7");
  assert.equal(list.videos.length, 1);
  const detail = await getVideo("v-1");
  assert.equal(detail.usage.practice_count, 2);
  const fav = await setVideoFavorite("v-1", true);
  assert.equal(fav.favorite, true);
  assert.deepEqual(calls[2].body, { favorite: true });
  await deleteVideo("v-1");
  const purged = await purgeVideoFile("v-1");
  assert.equal(purged.purged_at, "2026-09-21T04:00:00Z");
  assert.deepEqual(calls.map((c) => c.route), [
    "GET /v2/videos?filter=recent7",
    "GET /v2/videos/v-1",
    "PATCH /v2/videos/v-1",
    "DELETE /v2/videos/v-1",
    "POST /v2/videos/v-1/purge-file",
  ]);
});

test("practice.record·library: 영상 오류 코드마다 화면 문구가 있다", () => {
  const message = (code, status = 422) => errorMessage(new ApiError(status, code, code), "기본 문구");
  assert.equal(message("video_too_large"), "영상이 너무 커요(100MB 이내).");
  assert.equal(message("video_too_long"), "영상이 너무 길어요(5분 이내).");
  assert.equal(message("video_quota"), "보관함이 가득 찼어요. 영상을 지우거나 파일만 파기하면 다시 올릴 수 있어요.");
  assert.equal(message("video_in_use"), "회차나 챌린지에 쓰인 영상이라 지울 수 없어요. 파일만 파기할 수 있어요.");
  assert.equal(message("video_not_ready"), "이 영상은 아직 쓸 수 없어요. 다른 영상을 골라 주세요.");
  assert.equal(message("upload_expired"), "올릴 자리가 만료됐어요. 영상을 처음부터 다시 올려 주세요.");
});
