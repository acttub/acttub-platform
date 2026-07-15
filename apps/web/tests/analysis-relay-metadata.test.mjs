import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

async function importTypeScript(relativePath, transform = (source) => source) {
  const source = transform(readFileSync(path.join(appRoot, relativePath), "utf8"));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const source = (fileName, mimeType) => ({
  storagePath: `users/${userId}/practice-sessions/${sessionId}/${fileName}`,
  mimeType,
  fileName: "browser-controlled-name.mp4",
});

test("initial and retry analysis derive trusted MOV metadata from canonical persistence", async () => {
  const { deriveAnalysisRelayMetadata } = await importTypeScript(
    "src/server/services/analysis-source-preparation.ts",
  );

  for (const claimKind of ["analysis_create", "analysis_retry"]) {
    const metadata = deriveAnalysisRelayMetadata(
      { ...source("take.mov", "video/quicktime"), claimKind },
      userId,
      sessionId,
    );
    assert.deepEqual(metadata, {
      fileName: "take.mov",
      mimeType: "video/quicktime",
    });
  }

  assert.deepEqual(
    deriveAnalysisRelayMetadata(source("take.mp4", "video/mp4"), userId, sessionId),
    { fileName: "take.mp4", mimeType: "video/mp4" },
  );
});

test("invalid persisted path and MIME combinations fail closed", async () => {
  const {
    AnalysisSourceMetadataError,
    deriveAnalysisRelayMetadata,
    prepareAnalysisRelaySource,
  } =
    await importTypeScript("src/server/services/analysis-source-preparation.ts");

  const invalidSources = [
    source("take.mov", "video/mp4"),
    source("take.mp4", "video/quicktime"),
    source("original.mov", "video/quicktime"),
    { storagePath: "take.mov", mimeType: "video/quicktime" },
    { storagePath: `users/${userId}/practice-sessions/${sessionId}/../take.mov`, mimeType: "video/quicktime" },
    source("take.mov", "video/webm"),
  ];

  for (const invalidSource of invalidSources) {
    assert.throws(
      () => deriveAnalysisRelayMetadata(invalidSource, userId, sessionId),
      (error) =>
        error instanceof AnalysisSourceMetadataError &&
        error.code === "source_video_metadata_invalid",
    );
  }

  let adminCalls = 0;
  let fetchCalls = 0;
  await assert.rejects(
    prepareAnalysisRelaySource(invalidSources[0], userId, sessionId, {
      createAdminClient: () => {
        adminCalls += 1;
        return null;
      },
      fetchVideo: async () => {
        fetchCalls += 1;
        return new Response();
      },
    }),
    (error) => error instanceof AnalysisSourceMetadataError,
  );
  assert.equal(adminCalls, 0, "invalid metadata must fail before Storage signing");
  assert.equal(fetchCalls, 0, "invalid metadata must fail before source fetch");
});

test("multipart serializes matching MOV and MP4 relay metadata", async () => {
  const { createMultipartStream } = await importTypeScript(
    "src/server/acting-api/multipart.ts",
    (value) => value.replace('import "server-only";\n', ""),
  );

  for (const expected of [
    { fileName: "take.mov", mimeType: "video/quicktime" },
    { fileName: "take.mp4", mimeType: "video/mp4" },
  ]) {
    const video = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const multipart = createMultipartStream({
      fields: { situation: "scene" },
      video,
      ...expected,
    });
    const serialized = Buffer.from(await new Response(multipart.body).arrayBuffer()).toString();

    assert.match(serialized, new RegExp(`filename="${expected.fileName.replace(".", "\\.")}"`));
    assert.match(serialized, new RegExp(`Content-Type: ${expected.mimeType}`));
  }
});

test("analysis orchestration validates metadata before source fetch and dispatch", () => {
  const service = readFileSync(
    path.join(appRoot, "workers/lib/analysis-job-runner.mjs"),
    "utf8",
  );

  const prepareIndex = service.indexOf("validateAnalysisSource(");
  const summarizeIndex = service.indexOf("async function summarize(");
  assert.ok(prepareIndex >= 0 && prepareIndex < summarizeIndex);
  assert.doesNotMatch(service, /source\.fileName\s*\?\?/);
  assert.match(service, /source_video_metadata_invalid/);
});

test("invalid metadata persists as definitive and non-retryable with stable replay", () => {
  const service = readFileSync(
    path.join(appRoot, "src/server/services/acting-coach-service.ts"),
    "utf8",
  );
  const migration = readFileSync(
    path.join(repoRoot, "supabase/migrations/020_fastapi_422_definitive.sql"),
    "utf8",
  );
  const retryableCodes = migration.match(
    /analysis_retryable=\(p_failure_class='definitive' and p_safe_error_code in \(([^)]*)\)\)/,
  )?.[1];

  assert.match(service, /isDefinitive[\s\S]*"source_video_metadata_invalid"/);
  assert.match(
    service,
    /safeErrorCode:\s*persistedFailureCode\(mapped\)/,
  );
  assert.match(
    migration,
    /safe_error_code=p_safe_error_code,response_payload=public\.acttub_error_replay_payload\('analysis',p_failure_class,p_safe_error_code,null\)/,
  );
  assert.ok(retryableCodes, "the persisted analysis retry policy must remain explicit");
  assert.doesNotMatch(retryableCodes, /source_video_metadata_invalid/);
});
