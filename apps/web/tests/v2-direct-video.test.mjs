import assert from "node:assert/strict";
import { File } from "node:buffer";
import { afterEach, test } from "node:test";
import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
const { startDirectVideo, sendDirectVideo } = await import("../src/lib/api/v2/direct-video.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("영상 직접 입력은 파일 본문과 인증을 보존하고 multipart 경계는 브라우저에 맡긴다", async () => {
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/v2/coach/direct-video");
    assert.ok(options.body instanceof FormData);
    assert.equal(await options.body.get("video").text(), "video");
    assert.equal(options.headers.has("Content-Type"), false);
    assert.equal(options.headers.get("Authorization"), "Bearer guest-access");
    return new Response(JSON.stringify({ id: "test", status: "preparing" }), { status: 202 });
  };
  assert.equal((await startDirectVideo(file)).status, "preparing");
});

test("후속 대화의 JSON 전송은 기존 직렬화를 유지한다", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/v2/coach/direct-video/test/messages");
    assert.equal(options.headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(options.body), { text: "안심시키려 했어요." });
    return new Response(JSON.stringify({ id: "test", status: "replying" }), { status: 202 });
  };
  assert.equal((await sendDirectVideo("test", "안심시키려 했어요.")).status, "replying");
});
