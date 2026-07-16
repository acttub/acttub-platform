import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");
const flow = read("apps", "web", "src", "features", "practice", "practice-flow.tsx");

async function importTypeScriptModule(...parts) {
  const source = read(...parts);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const api = await importTypeScriptModule("apps", "web", "src", "lib", "api", "sessions.ts");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const report = {
  headline: "headline",
  biggestProblem: { start: "0", end: "1", dimension: "intent", description: "description" },
  evidence: "evidence",
  selfDiscovery: "discovery",
  encouragement: "encouragement",
  nextStep: "next",
  comparison: "comparison",
  reportCount: 1,
  additive: true,
};

const actingSession = {
  id: "session-1",
  userId: "user-1",
  pipelineVersion: "acting-api-v1",
  legacy: false,
  status: "INTERVIEW",
  medium: "영화",
  genre: "드라마",
  situation: "situation",
  characterContext: "context",
  subtext: "subtext",
  hiddenAt: null,
  createdAt: "created",
  updatedAt: "updated",
  take: {
    id: "take-1",
    durationMs: 1000,
    analysisStatus: "completed",
    analysisRetryable: false,
    analysisError: null,
    createdAt: "created",
  },
  sceneSummary: {
    observation: {},
    summary: "summary",
    intent_alignment: "aligned",
    key_moment: "moment",
    key_dimension: "dimension",
    anomalies: [{ kind: "none" }],
  },
  currentRun: {
    runId: "run-1",
    status: "live",
    closeReason: null,
    failureCode: null,
    failureRetryable: false,
    recoveryAction: null,
  },
  turns: [{
    id: "turn-1",
    runId: "run-1",
    ordinal: 1,
    role: "ai",
    text: "question",
    deliveryStatus: "completed",
    deliveryRetryable: false,
    deliveryErrorCode: null,
    action: "probe_intent",
    focusTimestamp: null,
    createdAt: "created",
  }],
  report,
  additive: { accepted: true },
};

const uploadIntentResponse = {
  uploadIntent: {
    uploadIntentId: "upload-1",
    sessionId: "session-1",
    userId: "user-1",
    storageBucket: "practice-videos",
    storagePath: "user/file.mp4",
    uploadUrl: "/upload",
    fileMetadata: { fileName: "file.mp4", mimeType: "video/mp4", sizeBytes: 1, durationMs: 1000 },
    status: "created",
    finalizedAt: null,
    constraints: { maxUploadBytes: 10, allowedMimeTypes: ["video/mp4"] },
    expiresAt: "expires",
    additive: true,
  },
  additive: true,
};

const finalizeResponse = {
  videoUrl: "/video",
  storagePath: "user/file.mp4",
  durationMs: null,
  additive: true,
};

const listResponse = {
  sessions: [{
    id: "session-1",
    pipelineVersion: "acting-api-v1",
    legacy: false,
    status: "INTERVIEW",
    title: "title",
    preview: null,
    durationMs: 1000,
    analysisStatus: "completed",
    createdAt: "created",
    updatedAt: "updated",
    additive: true,
  }],
  nextCursor: null,
  additive: true,
};

const legacySession = {
  id: "legacy-1",
  userId: "user-1",
  pipelineVersion: "legacy-gemini-v1",
  legacy: true,
  status: "LEGACY_OBSERVATIONS_PENDING",
  medium: "upload_url",
  genre: "드라마",
  situation: "situation",
  characterContext: "context",
  subtext: "subtext",
  hiddenAt: null,
  createdAt: "created",
  updatedAt: "updated",
  take: {
    id: "take-legacy",
    sessionId: "legacy-1",
    videoUrl: null,
    durationMs: null,
    analysisStatus: "generated",
    analysisError: null,
    createdAt: "created",
  },
  sceneSummary: null,
  currentRun: null,
  turns: [],
  report: null,
  legacyResult: null,
  additive: true,
};

const calls = [
  ["createPracticeUploadIntent", () => api.createPracticeUploadIntent({ fileMetadata: { fileName: "f", mimeType: "video/mp4", sizeBytes: 1 } }), uploadIntentResponse],
  ["finalizePracticeUploadIntent", () => api.finalizePracticeUploadIntent("upload-1", { storagePath: "p", durationMs: 1 }), finalizeResponse],
  ["listPracticeSessions", () => api.listPracticeSessions(), listResponse],
  ["getPracticeSession", () => api.getPracticeSession("session-1"), { session: actingSession, additive: true }],
  ["createPracticeSession", () => api.createPracticeSession({ requestId: "r", uploadIntentId: "u", situation: "s", characterContext: "c", subtext: "t" }), actingSession],
  ["retryPracticeAnalysis", () => api.retryPracticeAnalysis("session-1", "r"), actingSession],
  ["mutatePracticeTurn", () => api.mutatePracticeTurn("session-1", { operation: "start", requestId: "r" }), actingSession],
  ["createPracticeReport", () => api.createPracticeReport("session-1", "r"), report],
];

function stubResponse(body, status, headers = { "Content-Type": "application/json" }) {
  globalThis.fetch = async () => new Response(body, { status, headers });
}

async function assertInvalidResponse(call, status) {
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof api.ApiClientError);
    assert.equal(error.status, status);
    assert.equal(error.code, "invalid_response");
    assert.equal(error.message, "응답을 확인하지 못했어요.");
    assert.doesNotMatch(error.message, /Unexpected|JSON|<html>|truncated/i);
    return true;
  });
}

test("malformed successful bodies are product-safe typed failures with their actual status", async () => {
  const malformedBodies = [
    "",
    "<html>not json</html>",
    '{"truncated":',
    "null",
    '"primitive"',
    "42",
    "true",
    "[]",
    "{}",
  ];
  const statuses = [200, 201, 202];

  for (let index = 0; index < malformedBodies.length; index += 1) {
    const status = statuses[index % statuses.length];
    stubResponse(malformedBodies[index], status);
    await assertInvalidResponse(() => api.createPracticeSession({}), status);
  }
});

test("all active endpoint guards reject an endpoint-specific invalid successful shape", async () => {
  for (const [name, call] of calls) {
    stubResponse(JSON.stringify({ wrongEndpointShape: name }), 200);
    await assertInvalidResponse(call, 200);
  }
});

test("all active endpoint guards return the original valid payload and accept additive fields", async () => {
  for (const [name, call, payload] of calls) {
    stubResponse(JSON.stringify(payload), 200);
    assert.deepEqual(await call(), payload, name);
  }
});

test("get session accepts the guarded legacy discriminator shape", async () => {
  const payload = { session: legacySession, additive: true };
  stubResponse(JSON.stringify(payload), 200);
  assert.deepEqual(await api.getPracticeSession("legacy-1"), payload);
});

test("valid non-success error envelopes retain status code message and details", async () => {
  for (const status of [400, 401, 500]) {
    const details = { status, retryable: false };
    stubResponse(JSON.stringify({ error: { code: `code_${status}`, message: `message_${status}`, details, additive: true } }), status);
    await assert.rejects(() => api.listPracticeSessions(), (error) => {
      assert.ok(error instanceof api.ApiClientError);
      assert.equal(error.status, status);
      assert.equal(error.code, `code_${status}`);
      assert.equal(error.message, `message_${status}`);
      assert.deepEqual(error.details, details);
      return true;
    });
  }
});

test("invalid non-success bodies retain status and never leak parser or body text", async () => {
  const invalidBodies = ["", "<html>bad</html>", '{"truncated":', "null", '"primitive"', JSON.stringify({ error: { code: 1, message: false } })];
  for (const status of [400, 401, 500]) {
    for (const body of invalidBodies) {
      stubResponse(body, status);
      await assert.rejects(() => api.listPracticeSessions(), (error) => {
        assert.ok(error instanceof api.ApiClientError);
        assert.equal(error.status, status);
        assert.equal(error.code, "unknown_error");
        assert.equal(error.message, "요청을 처리하지 못했어요.");
        assert.doesNotMatch(error.message, /Unexpected|JSON|<html>|truncated/i);
        return true;
      });
    }
  }
});

test("204 is an invalid success because every active endpoint contracts JSON", async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await assertInvalidResponse(() => api.listPracticeSessions(), 204);
});

test("invalid response mutations reconcile before remaining unsettled", () => {
  assert.match(
    flow,
    /function isDefinitiveMutationFailure[\s\S]*reason\.code\s*!==\s*"invalid_response"/,
  );
  let mutationCatchCount = 0;
  for (const catchBody of flow.matchAll(/catch \(reason\) \{([\s\S]*?)\n\s*\}(?: finally|\n\s*async function)/g)) {
    if (!catchBody[1].includes("isDefinitiveMutationFailure(reason)")) continue;
    mutationCatchCount += 1;
    assert.ok(
      catchBody[1].indexOf("recoverPersistedSession") < catchBody[1].indexOf("isDefinitiveMutationFailure(reason)"),
      "persisted state must be read before deciding whether to settle the logical attempt",
    );
  }
  assert.ok(mutationCatchCount >= 6, "all mutation catch paths must remain covered");
  assert.match(flow, /function errorMessage[\s\S]*error instanceof Error \? error\.message/);
});
