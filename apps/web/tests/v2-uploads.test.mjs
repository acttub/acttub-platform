import assert from "node:assert/strict";
import { File } from "node:buffer";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { UploadError, uploadVideo } = await import("../src/lib/api/v2/uploads.ts");
const { MAX_UPLOAD_BYTES } = await import("../src/lib/config/env.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("uploadVideo는 intent, S3 PUT, complete 순서와 서명 MIME을 지킨다", async () => {
  const order = [];
  const file = new File(["video-bytes"], "take.mp4", { type: "video/mp4" });
  let intentBody;

  globalThis.fetch = async (url, options) => {
    if (String(url) === "/v2/uploads/intents") {
      order.push("intent");
      intentBody = JSON.parse(options.body);
      return jsonResponse({
        intent_id: "intent-1",
        upload_url: "https://s3.example/upload",
        expires_at: "2026-07-18T00:00:00Z",
      });
    }

    assert.equal(String(url), "/v2/uploads/intents/intent-1/complete");
    assert.equal(options.method, "POST");
    order.push("complete");
    return jsonResponse({ intent_id: "intent-1", status: "finalized" });
  };

  const uploader = async (args) => {
    order.push("put");
    assert.equal(args.url, "https://s3.example/upload");
    assert.equal(args.file, file);
    assert.equal(args.contentType, "video/mp4");
  };

  assert.deepEqual(
    await uploadVideo(file, { durationMs: 12_345, uploader }),
    { intentId: "intent-1" },
  );
  assert.deepEqual(order, ["intent", "put", "complete"]);
  assert.deepEqual(intentBody, {
    mime_type: "video/mp4",
    size_bytes: file.size,
    duration_ms: 12_345,
  });
});

test("video가 아닌 파일은 intent 요청 전에 거부한다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected fetch");
  };

  const file = new File(["plain text"], "notes.txt", { type: "text/plain" });
  await assert.rejects(
    uploadVideo(file, { uploader: async () => {} }),
    (error) => error instanceof UploadError && error.stage === "intent",
  );
  assert.equal(fetchCount, 0);
});

test("최대 크기를 넘는 영상은 intent 요청 전에 거부한다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected fetch");
  };

  const oversizedFile = {
    name: "oversized.mp4",
    type: "video/mp4",
    size: MAX_UPLOAD_BYTES + 1,
  };
  await assert.rejects(
    uploadVideo(oversizedFile, { uploader: async () => {} }),
    (error) => error instanceof UploadError && error.stage === "intent",
  );
  assert.equal(fetchCount, 0);
});

test("S3 PUT 실패는 complete를 호출하지 않고 put 단계 오류로 남긴다", async () => {
  const file = new File(["video-bytes"], "take.mp4", { type: "video/mp4" });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse({
      intent_id: "intent-put-failure",
      upload_url: "https://s3.example/upload",
      expires_at: "2026-07-18T00:00:00Z",
    });
  };

  await assert.rejects(
    uploadVideo(file, {
      uploader: async () => {
        throw new Error("S3 unavailable");
      },
    }),
    (error) => error instanceof UploadError && error.stage === "put",
  );
  assert.equal(fetchCount, 1);
});

test("finalize 실패는 complete 단계 오류로 남긴다", async () => {
  const file = new File(["video-bytes"], "take.mp4", { type: "video/mp4" });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return jsonResponse({
        intent_id: "intent-complete-failure",
        upload_url: "https://s3.example/upload",
        expires_at: "2026-07-18T00:00:00Z",
      });
    }
    return jsonResponse({ detail: "storage unavailable" }, 503);
  };

  await assert.rejects(
    uploadVideo(file, { uploader: async () => {} }),
    (error) => error instanceof UploadError && error.stage === "complete",
  );
  assert.equal(fetchCount, 2);
});

test("이미 취소된 업로드는 fetch 전에 AbortError로 끝난다", async () => {
  const file = new File(["video-bytes"], "take.mp4", { type: "video/mp4" });
  const controller = new AbortController();
  controller.abort();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected fetch");
  };

  await assert.rejects(
    uploadVideo(file, { signal: controller.signal, uploader: async () => {} }),
    (error) =>
      error instanceof UploadError &&
      error.stage === "intent" &&
      error.name === "AbortError",
  );
  assert.equal(fetchCount, 0);
});
