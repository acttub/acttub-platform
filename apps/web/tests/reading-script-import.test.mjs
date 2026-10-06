// reading.script — 대본 넣기 한 번의 흐름: 파일 올리기 세 단계, 나누기 맡기기, 1초 폴링과 120초 기한, 실패 종류,
// 플래그를 켠 재요청, 동의 뒤 재요청. 서버 호출은 가짜로 바꿔 순서와 실린 값을 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { agreeAndRetry, newAttempt, retryWith, runImport } = await import("../src/lib/reading/script/import.ts");
const { ApiError, NetworkError } = await import("../src/lib/api/v2/errors.ts");

const job = (status, done = 0, total = 0, rest = {}) => ({
  id: "import-1",
  status,
  progress: { done_lines: done, total_lines: total },
  script_id: null,
  failure: null,
  ...rest,
});

/** 가짜 서버. 부른 순서를 calls 에 적고, getImport 는 jobs 를 차례로 답한다(끝나면 마지막 것을 되풀이). */
function fakeServer({ jobs = [job("succeeded", 0, 0, { script_id: "script-9" })], ticket = { import_id: "import-1", duplicate_script_id: null }, overrides = {} } = {}) {
  const calls = [];
  let clock = 0;
  let polls = 0;
  const deps = {
    createUpload: async (file) => {
      calls.push(["createUpload", file.name, file.size]);
      return { upload_id: "upload-1", upload_url: "https://s3.example/put", content_type: "application/octet-stream", expires_at: "" };
    },
    putUpload: async (upload, file) => {
      calls.push(["putUpload", upload.upload_url, upload.content_type, file.name]);
    },
    completeUpload: async (uploadId) => {
      calls.push(["completeUpload", uploadId]);
    },
    startImport: async (body, requestId) => {
      calls.push(["startImport", requestId, body]);
      return ticket;
    },
    getImport: async (importId) => {
      calls.push(["getImport", importId]);
      const next = jobs[Math.min(polls, jobs.length - 1)];
      polls += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    listConsentDocuments: async () => [
      { id: "doc-privacy", type: "privacy" },
      { id: "doc-split", type: "script_split" },
    ],
    grantConsent: async (documentId) => {
      calls.push(["grantConsent", documentId]);
    },
    ...overrides,
  };
  return { deps, calls, elapsed: () => clock };
}

const text = (t = "윤서: 안녕.\n태오: 응.") => ({ kind: "text", text: t, source: "paste" });
const file = (name = "갈매기.pdf", size = 1_200_000) => ({ kind: "file", file: new File([new Uint8Array(size)], name) });
const names = (calls) => calls.map((c) => c[0]);

test("reading.script: 글은 그대로 맡기고 1초마다 물어 진행 줄 수를 알린 뒤 저장된 대본 id 로 끝난다", async () => {
  const { deps, calls, elapsed } = fakeServer({
    jobs: [job("pending"), job("running", 24, 61), job("running", 61, 61), job("succeeded", 61, 61, { script_id: "script-9" })],
  });
  const attempt = { ...newAttempt(text()), requestId: "11111111-1111-4111-8111-111111111111" };
  const seen = [];

  const { outcome } = await runImport(attempt, deps, (p) => seen.push(`${p.doneLines}/${p.totalLines}`));

  assert.deepEqual(outcome, { kind: "saved", scriptId: "script-9" });
  assert.deepEqual(calls[0], [
    "startImport",
    "11111111-1111-4111-8111-111111111111",
    { raw_text: "윤서: 안녕.\n태오: 응.", source: "paste", allow_duplicate: false, skip_script_check: false },
  ]);
  assert.deepEqual(names(calls), ["startImport", "getImport", "getImport", "getImport", "getImport"]);
  assert.deepEqual(seen, ["0/0", "24/61", "61/61", "61/61"]);
  assert.equal(elapsed(), 3_000);
});

test("reading.script: 파일은 올릴 자리 → S3 PUT → 글자 뽑기 뒤 upload_id 로 맡기고, 돌려준 attempt 에 그 id 가 남는다", async () => {
  const { deps, calls } = fakeServer();

  const { outcome, attempt } = await runImport(newAttempt(file()), deps, () => {});

  assert.deepEqual(outcome, { kind: "saved", scriptId: "script-9" });
  assert.deepEqual(calls.slice(0, 4), [
    ["createUpload", "갈매기.pdf", 1_200_000],
    ["putUpload", "https://s3.example/put", "application/octet-stream", "갈매기.pdf"],
    ["completeUpload", "upload-1"],
    ["startImport", attempt.requestId, { upload_id: "upload-1", source: "file", allow_duplicate: false, skip_script_check: false }],
  ]);
  assert.equal(attempt.uploadId, "upload-1");
});

test("reading.script: 50,000,000바이트를 넘거나 txt·docx·pdf·hwp·hwpx 밖의 파일은 올리지 않고 R2.4 로 끝난다", async () => {
  const cases = [
    [file("긴대본.pdf", 50_000_001), "file_too_large"],
    [file("대본.doc", 10), "file_unreadable"],
    [file("대본", 10), "file_unreadable"],
  ];
  for (const [input, kind] of cases) {
    const { deps, calls } = fakeServer();
    const { outcome } = await runImport(newAttempt(input), deps, () => {});
    assert.deepEqual(outcome, { kind }, input.file.name);
    assert.deepEqual(calls, [], input.file.name);
  }
  for (const input of [file("대본.HWPX", 10), file("딱맞음.txt", 50_000_000)]) {
    const { deps, calls } = fakeServer();
    await runImport(newAttempt(input), deps, () => {});
    assert.equal(calls[0][0], "createUpload", input.file.name);
  }
});

test("reading.script: 실패한 작업은 failure 마다 대본 아님(R2.8)·배역 없음(R2.13)·저장 실패(R2.12) 로 접힌다", async () => {
  const cases = [
    ["not_script", { kind: "not_script" }],
    ["no_characters", { kind: "no_characters" }],
    ["script_too_long", { kind: "failed", message: "대본이 너무 길어요. 원문 100,000자·줄 3,000개·배역 50명까지 저장할 수 있어요." }],
    ["script_limit", { kind: "failed", message: "대본은 20개까지 저장할 수 있어요. 안 쓰는 대본을 지우면 다시 저장할 수 있어요." }],
    ["failed", { kind: "failed", message: "네트워크 연결을 확인하고 다시 시도해주세요." }],
    [null, { kind: "failed", message: "네트워크 연결을 확인하고 다시 시도해주세요." }],
  ];
  for (const [failure, expected] of cases) {
    const { deps } = fakeServer({ jobs: [job("failed", 0, 0, { failure })] });
    const { outcome } = await runImport(newAttempt(text()), deps, () => {});
    assert.deepEqual(outcome, expected, String(failure));
  }
});

test("reading.script: 서버 오류 코드는 동의(R2.14)·하루 한도(R2.15)·파일(R2.4)·저장 실패(R2.12) 대화상자가 된다", async () => {
  const at = (stage, error) => ({ [stage]: async () => Promise.reject(error) });
  const cases = [
    [text(), at("startImport", new ApiError(403, "script_split_consent_required", "")), { kind: "consent_required" }],
    [text(), at("startImport", new ApiError(429, "script_split_daily_limit", "")), { kind: "daily_limit" }],
    [file(), at("createUpload", new ApiError(403, "script_split_consent_required", "")), { kind: "consent_required" }],
    [file(), at("createUpload", new ApiError(422, "script_file_too_large", "")), { kind: "file_too_large" }],
    [file(), at("completeUpload", new ApiError(422, "script_file_unreadable", "")), { kind: "file_unreadable" }],
    [
      file(),
      at("completeUpload", new ApiError(422, "script_too_long", "")),
      { kind: "failed", message: "대본이 너무 길어요. 원문 100,000자·줄 3,000개·배역 50명까지 저장할 수 있어요." },
    ],
    [file(), at("putUpload", new Error("S3 PUT failed")), { kind: "failed", message: "네트워크 연결을 확인하고 다시 시도해주세요." }],
  ];
  for (const [input, overrides, expected] of cases) {
    const { deps } = fakeServer({ overrides });
    const { outcome } = await runImport(newAttempt(input), deps, () => {});
    assert.deepEqual(outcome, expected, JSON.stringify(expected));
  }
});

test("reading.script: 작업이 120초 안에 끝나지 않으면 더 묻지 않고 저장 실패(R2.12)다", async () => {
  const { deps, calls, elapsed } = fakeServer({ jobs: [job("running", 3, 900)] });

  const { outcome } = await runImport(newAttempt(text()), deps, () => {});

  assert.deepEqual(outcome, { kind: "failed", message: "네트워크 연결을 확인하고 다시 시도해주세요." });
  assert.equal(elapsed(), 120_000);
  assert.equal(names(calls).filter((n) => n === "getImport").length, 120);
});

test("reading.script: 폴링 한 번이 끊기거나 429·5xx 면 기한 안에서 다시 묻고, 404 면 그만둔다", async () => {
  const flaky = fakeServer({
    jobs: [
      new NetworkError("끊김"),
      new ApiError(429, "rate_limited", ""),
      new ApiError(502, "bad_gateway", ""),
      job("succeeded", 5, 5, { script_id: "script-9" }),
    ],
  });
  assert.deepEqual((await runImport(newAttempt(text()), flaky.deps, () => {})).outcome, { kind: "saved", scriptId: "script-9" });

  const gone = fakeServer({ jobs: [new ApiError(404, "import_not_found", "")] });
  const { outcome } = await runImport(newAttempt(text()), gone.deps, () => {});
  assert.equal(outcome.kind, "failed");
  assert.equal(names(gone.calls).filter((n) => n === "getImport").length, 1);
});

test("reading.script: 같은 글의 대본이 있으면 R2.7 이고, [새로 넣기]는 새 요청 id 에 allow_duplicate 를 켜고 올린 파일을 다시 올리지 않는다", async () => {
  const first = fakeServer({ ticket: { import_id: null, duplicate_script_id: "script-old" } });
  const { outcome, attempt } = await runImport(newAttempt(file()), first.deps, () => {});
  assert.deepEqual(outcome, { kind: "duplicate", scriptId: "script-old" });

  const again = retryWith(attempt, "allowDuplicate");
  const second = fakeServer();
  assert.deepEqual((await runImport(again, second.deps, () => {})).outcome, { kind: "saved", scriptId: "script-9" });
  assert.notEqual(again.requestId, attempt.requestId);
  assert.deepEqual(second.calls[0], [
    "startImport",
    again.requestId,
    { upload_id: "upload-1", source: "file", allow_duplicate: true, skip_script_check: false },
  ]);
});

test("reading.script: R2.8 [그래도 나누기]는 새 요청 id 에 skip_script_check 를 켜 같은 글을 다시 맡긴다", async () => {
  const first = fakeServer({ jobs: [job("failed", 0, 0, { failure: "not_script" })] });
  const { attempt } = await runImport(newAttempt(text("오늘 장 볼 것: 우유, 달걀")), first.deps, () => {});

  const again = retryWith(attempt, "skipScriptCheck");
  const second = fakeServer();
  await runImport(again, second.deps, () => {});

  assert.notEqual(again.requestId, attempt.requestId);
  assert.deepEqual(second.calls[0][2], { raw_text: "오늘 장 볼 것: 우유, 달걀", source: "paste", allow_duplicate: false, skip_script_check: true });
});

test("reading.script: R2.14 [동의하고 나누기]는 현재 판 script_split 문서에 동의한 뒤 같은 요청 id 로 다시 맡긴다", async () => {
  let consented = false;
  const { deps, calls } = fakeServer({
    overrides: {
      grantConsent: async (documentId) => {
        calls.push(["grantConsent", documentId]);
        consented = true;
      },
      startImport: async (body, requestId) => {
        calls.push(["startImport", requestId, body]);
        if (!consented) throw new ApiError(403, "script_split_consent_required", "");
        return { import_id: "import-1", duplicate_script_id: null };
      },
    },
  });
  const blocked = await runImport(newAttempt(text()), deps, () => {});
  assert.deepEqual(blocked.outcome, { kind: "consent_required" });

  const { outcome } = await agreeAndRetry(blocked.attempt, deps, () => {});

  assert.deepEqual(outcome, { kind: "saved", scriptId: "script-9" });
  assert.deepEqual(names(calls), ["startImport", "grantConsent", "startImport", "getImport"]);
  assert.equal(calls[1][1], "doc-split");
  assert.equal(calls[2][1], calls[0][1]);
});

test("reading.script: 동의를 저장하지 못하면 다시 맡기지 않고 동의 대화상자에 까닭을 싣는다. 문서가 아직 없으면 저장 실패다", async () => {
  const refused = fakeServer({
    overrides: { grantConsent: async () => Promise.reject(new ApiError(403, "member_only", "회원만 결정할 수 있습니다.")) },
  });
  const attempt = newAttempt(text());
  const { outcome } = await agreeAndRetry(attempt, refused.deps, () => {});
  assert.equal(outcome.kind, "consent_required");
  assert.equal(typeof outcome.error, "string");
  assert.deepEqual(refused.calls, []);

  const noDocument = fakeServer({ overrides: { listConsentDocuments: async () => [{ id: "doc-privacy", type: "privacy" }] } });
  assert.deepEqual((await agreeAndRetry(attempt, noDocument.deps, () => {})).outcome, {
    kind: "failed",
    message: "네트워크 연결을 확인하고 다시 시도해주세요.",
  });
  assert.deepEqual(noDocument.calls, []);
});
