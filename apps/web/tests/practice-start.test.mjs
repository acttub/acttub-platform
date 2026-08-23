import assert from "node:assert/strict";
import { File } from "node:buffer";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { UploadError } = await import("../src/lib/api/v2/uploads.ts");
const { startPractice, startVideoUpload } = await import(
  "../src/features/workspace/practice-start.ts"
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

const SCENE = {
  situation: "  면접 첫 인사  ",
  characterContext: " 긴장한 지원자 ",
  goal: " 담담하게 말하기 ",
};

const BLOCKAGE = {
  blockage_kind: "표현",
  sub_branch: "몸이 굳어요",
  blockage_detail: null,
};

/** finalize·세션 생성 두 요청을 순서대로 받아 적는 fetch. */
function apiStub({ finalize = () => jsonResponse({ status: "finalized" }), create } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : null });
    if (path.endsWith("/complete")) return finalize();
    assert.equal(path, "/v2/practice-sessions");
    return create
      ? create()
      : jsonResponse({ session_id: "practice-1", status: "analyzed" });
  };
  return calls;
}

function uploaded(overrides = {}) {
  return Promise.resolve({
    intentId: "intent-1",
    durationMs: 4_000,
    compressionRan: true,
    ...overrides,
  });
}

function startInput(overrides = {}) {
  return {
    upload: uploaded(),
    signal: new AbortController().signal,
    scene: SCENE,
    blockage: BLOCKAGE,
    ...overrides,
  };
}

test("업로드를 확정하고 연습 세션을 만든 뒤 세션과 영상 길이를 돌려준다", async () => {
  const calls = apiStub();

  const result = await startPractice(startInput());

  assert.deepEqual(result, {
    ok: true,
    session: { session_id: "practice-1", status: "analyzed" },
    durationMs: 4_000,
    compressionRan: true,
  });
  // 확정이 세션 생성보다 먼저다 — 순서가 뒤집히면 세션 없는 영상이 S3 에 남는다.
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/v2/uploads/intents/intent-1/complete", "/v2/practice-sessions"],
  );
  assert.equal(calls[1].body.upload_intent_id, "intent-1");
  assert.equal(calls[1].body.situation, "면접 첫 인사");
  assert.equal(calls[1].body.character_context, "긴장한 지원자");
  assert.equal(calls[1].body.goal, "담담하게 말하기");
  assert.equal(calls[1].body.blockage_kind, "표현");
});

test("이어받을 연습이 없으면 continued_from 키 자체가 빠진다", async () => {
  const calls = apiStub();

  await startPractice(startInput());

  assert.equal("continued_from" in calls[1].body, false);
});

test("이어받을 연습을 주면 그 id 를 요청에 싣는다", async () => {
  const calls = apiStub();

  await startPractice(startInput({ continueFromId: "practice-0" }));

  assert.equal(calls[1].body.continued_from, "practice-0");
});

test("압축을 안 돌린 업로드는 그 사실을 그대로 돌려준다", async () => {
  apiStub();

  const result = await startPractice(
    startInput({ upload: uploaded({ compressionRan: false }) }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.compressionRan, false);
});

test("업로드가 UploadError 로 엎어지면 그 예외가 말하는 자리를 그대로 쓴다", async () => {
  apiStub();

  const result = await startPractice(
    startInput({
      upload: Promise.reject(new UploadError("put", "영상을 올리지 못했어요.")),
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.stage, "put");
  assert.equal(result.message, "영상을 올리지 못했어요.");
  assert.equal(result.aborted, false);
});

test("업로드에 닿기 전 실패(압축·길이 검사)는 preflight 로 센다", async () => {
  apiStub();

  const result = await startPractice(
    startInput({ upload: Promise.reject(new Error("영상은 5분 이하여야 해요.")) }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.equal(result.message, "영상은 5분 이하여야 해요.");
});

test("확정 실패는 complete 로 센다", async () => {
  apiStub({
    finalize: () => jsonResponse({ detail: "upload_not_found" }, 409),
  });

  const result = await startPractice(startInput());

  assert.equal(result.ok, false);
  assert.equal(result.stage, "complete");
});

test("🔥 세션 생성 실패는 preflight 가 아니라 session_create 로 센다", async () => {
  // 업로드가 다 끝난 뒤 터지는 실패는 UploadError 가 아니라, 예외만 봐서는 어디서
  // 엎어졌는지 가릴 수 없다. 이 갈래가 무너지면 세션 생성 실패가 전부 preflight 로
  // 기록되어 "영상을 못 올린다" 는 이야기가 된다.
  apiStub({ create: () => jsonResponse({ detail: "scene_required" }, 400) });

  const result = await startPractice(startInput());

  assert.equal(result.ok, false);
  assert.equal(result.stage, "session_create");
});

test("배우가 그만둔 것은 aborted 로 갈라 오류를 띄우지 않게 한다", async () => {
  apiStub();
  const abort = new Error("The operation was aborted.");
  abort.name = "AbortError";

  const result = await startPractice(startInput({ upload: Promise.reject(abort) }));

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
});

test("UploadError 로 감싸인 중단도 aborted 다", async () => {
  apiStub();
  const abort = new Error("The operation was aborted.");
  abort.name = "AbortError";

  const result = await startPractice(
    startInput({
      upload: Promise.reject(new UploadError("put", "중단됐어요.", abort)),
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.stage, "put");
});

test("Error 가 아닌 것이 던져지면 보여 줄 말을 대신 채운다", async () => {
  apiStub();

  const result = await startPractice(startInput({ upload: Promise.reject("웬 문자열") }));

  assert.equal(result.ok, false);
  assert.equal(result.message, "문제가 생겼어요. 다시 시도해 주세요.");
  assert.equal(result.aborted, false);
  assert.equal(result.cause, "웬 문자열");
});

test("Error 인데 할 말이 비어 있어도 화면이 빈 줄을 그리지 않는다", async () => {
  apiStub();

  // 서버가 detail 을 빈 문자열로 주면 ApiError.message 가 빈다. 옛 코드는 그것을 그대로
  // 화면에 실어 오류 자리가 아무 말도 없이 떴다.
  const result = await startPractice(
    startInput({ upload: Promise.reject(new Error("")) }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, "문제가 생겼어요. 다시 시도해 주세요.");
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

function uploadStub() {
  const seen = {};
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path === "/v2/uploads/intents") {
      return jsonResponse({
        intent_id: "intent-7",
        upload_url: "https://s3.example/upload",
        expires_at: "2026-07-18T00:00:00Z",
      });
    }
    seen.finalized = path;
    return jsonResponse({ status: "finalized" });
  };
  return seen;
}

test("업로드를 띄우면 진행률을 먼저 되돌리고 압축·업로드를 차례로 알린다", async () => {
  uploadStub();
  const events = [];
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  const pending = startVideoUpload(file, {
    onProgress: (event) => events.push(event),
    prepare: fakePrepare({ compress: 0.5 }),
    uploader: fakeUploader(),
  });

  assert.deepEqual(events[0], { type: "reset" });
  assert.deepEqual(await pending.promise, {
    intentId: "intent-7",
    durationMs: 7_000,
    compressionRan: true,
  });
  assert.deepEqual(events[1], { type: "compress", ratio: 0.5 });
  // 압축이 돌았으면 업로드 막대는 압축이 끝난 자리에서 이어진다.
  assert.equal(events.at(-1).type, "upload");
  assert.equal(events.at(-1).compressed, true);
});

test("압축이 한 번도 안 돌면 업로드 구간은 0 부터 그린다", async () => {
  uploadStub();
  const events = [];
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  const pending = startVideoUpload(file, {
    onProgress: (event) => events.push(event),
    prepare: fakePrepare(),
    uploader: fakeUploader(),
  });

  assert.equal((await pending.promise).compressionRan, false);
  assert.equal(events.some((event) => event.type === "compress"), false);
  assert.equal(events.at(-1).compressed, false);
});

test("업로드는 완료 처리를 하지 않는다 — 확정은 startPractice 의 몫이다", async () => {
  const seen = uploadStub();
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  await startVideoUpload(file, {
    onProgress: () => {},
    prepare: fakePrepare(),
    uploader: fakeUploader(),
  }).promise;

  // 막힘을 고르다 그만두면 완료된 인텐트는 만료 스윕이 회수하지 않는다.
  assert.equal(seen.finalized, undefined);
});

test("막힘을 고르는 동안 엎어져도 아무도 안 받는 거절로 남지 않는다", async () => {
  uploadStub();
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: async () => {
      throw new Error("영상은 5분 이하여야 해요.");
    },
  });

  // 여기서 삼키지 않으면 unhandled rejection 으로 터진다. 실제 오류 처리는
  // startPractice 가 이 약속을 await 할 때 한 번만 한다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(pending.promise, /5분 이하/);
});

test("업로드를 끊으면 압축과 S3 PUT 양쪽이 함께 끊긴다", async () => {
  uploadStub();
  const seen = [];
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: async (given, options) => {
      seen.push(options.signal);
      return { file: given, durationMs: 7_000, wasCompressed: false, compressMs: 0 };
    },
    uploader: async ({ signal, onProgress }) => {
      seen.push(signal);
      onProgress?.({ percent: 100 });
    },
  });
  await pending.promise;
  pending.controller.abort();

  // 영상을 바꾸거나 연습을 떠나면 이 신호 하나로 둘 다 끊는다.
  assert.equal(seen.length, 2);
  assert.equal(seen.filter((signal) => signal?.aborted).length, 2);
});

test("업로드마다 제 신호를 들고 나오고 그 파일을 기억한다", () => {
  uploadStub();
  const file = new File(["video"], "take.mp4", { type: "video/mp4" });

  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: fakePrepare(),
    uploader: fakeUploader(),
  });

  assert.equal(pending.file, file);
  assert.equal(pending.controller.signal.aborted, false);
});

test("SOMA-381: 업로드가 끝나면 압축·업로드 실측을 따로 담아 알린다", async () => {
  uploadStub();
  const file = new File([new Uint8Array(2_000_000)], "take.mp4", { type: "video/mp4" });
  const profiles = [];
  let clock = 10_000;
  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: async (given, options) => {
      options.onCompressionProgress(1);
      return {
        file: new File([new Uint8Array(500_000)], "take.c.mp4", { type: "video/mp4" }),
        durationMs: 7_000,
        wasCompressed: true,
        compressMs: 4_200,
      };
    },
    uploader: fakeUploader(),
    onProfile: (profile) => profiles.push(profile),
    now: () => {
      // 업로드 시작·종료에서 한 번씩 읽는다 — 두 번째 읽기에 3초를 흘려 보낸다.
      const at = clock;
      clock += 3_000;
      return at;
    },
  });
  await pending.promise;

  assert.equal(profiles.length, 1);
  const profile = profiles[0];
  assert.equal(profile.compressMs, 4_200);
  assert.equal(profile.uploadMs, 3_000);
  assert.equal(profile.originalBytes, 2_000_000);
  assert.equal(profile.uploadedBytes, 500_000);
  assert.equal(profile.wasCompressed, true);
  assert.equal(profile.webcodecsSupported, false); // node에는 VideoEncoder가 없다
  assert.equal(profile.videoDurationMs, 7_000);
});

test("SOMA-381: 업로드가 실패하면 실측을 알리지 않는다 — 반쪽 숫자는 평균을 오염시킨다", async () => {
  uploadStub();
  const file = new File([new Uint8Array(1_000)], "take.mp4", { type: "video/mp4" });
  const profiles = [];
  const pending = startVideoUpload(file, {
    onProgress: () => {},
    prepare: fakePrepare(),
    uploader: async () => {
      throw new Error("네트워크가 끊겼어요");
    },
    onProfile: (profile) => profiles.push(profile),
  });
  await pending.promise.catch(() => {});

  assert.equal(profiles.length, 0);
});
