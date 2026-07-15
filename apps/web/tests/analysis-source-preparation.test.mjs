import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importSourcePreparation() {
  const source = readFileSync(
    path.join(appRoot, "src/server/services/analysis-source-preparation.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const source = {
  storageBucket: "practice-videos",
  storagePath: "users/user-1/practice-sessions/session-1/take.mp4",
};

const signedUrlClient = (result) => ({
  storage: {
    from: () => ({ createSignedUrl: async () => result }),
  },
});

test("source preparation classifies admin and signed URL failures before dispatch", async () => {
  const { AnalysisSourcePreparationError, prepareAnalysisVideoSource } =
    await importSourcePreparation();

  for (const createAdminClient of [
    () => null,
    () => signedUrlClient({ data: null, error: new Error("signing unavailable") }),
    () => signedUrlClient({ data: { signedUrl: "" }, error: null }),
  ]) {
    let fetchCalls = 0;
    await assert.rejects(
      prepareAnalysisVideoSource(source, {
        createAdminClient,
        fetchVideo: async () => {
          fetchCalls += 1;
          return new Response();
        },
      }),
      (error) =>
        error instanceof AnalysisSourcePreparationError &&
        error.code === "source_video_unavailable",
    );
    assert.equal(fetchCalls, 0);
  }
});

test("Storage GET 403, 404, and 5xx are definitive source failures", async () => {
  const { AnalysisSourcePreparationError, prepareAnalysisVideoSource } =
    await importSourcePreparation();
  const createAdminClient = () =>
    signedUrlClient({ data: { signedUrl: "https://storage.test/video" }, error: null });

  for (const status of [403, 404, 500, 503]) {
    await assert.rejects(
      prepareAnalysisVideoSource(source, {
        createAdminClient,
        fetchVideo: async () => new Response(null, { status }),
      }),
      (error) =>
        error instanceof AnalysisSourcePreparationError &&
        error.code === "source_video_unavailable",
    );
  }

  await assert.rejects(
    prepareAnalysisVideoSource(source, {
      createAdminClient,
      fetchVideo: async () => {
        throw new TypeError("Storage connection reset");
      },
    }),
    (error) =>
      error instanceof AnalysisSourcePreparationError &&
      error.code === "source_video_unavailable",
  );
});

test("successful source preparation returns the original response body", async () => {
  const { prepareAnalysisVideoSource } = await importSourcePreparation();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });

  const prepared = await prepareAnalysisVideoSource(source, {
    createAdminClient: () =>
      signedUrlClient({ data: { signedUrl: "https://storage.test/video" }, error: null }),
    fetchVideo: async () => new Response(body, { status: 200 }),
  });

  assert.equal(prepared, body);
});

test("analysis orchestration prepares the source before summarize dispatch", () => {
  const service = readFileSync(
    path.join(appRoot, "src/server/services/acting-coach-service.ts"),
    "utf8",
  );

  assert.match(service, /prepareAnalysisRelaySource[\s\S]*actingApiClient\.summarize/);
  assert.match(service, /source_video_unavailable/);
  assert.match(service, /failureClass:\s*isDefinitive\(mapped\)\s*\?\s*"definitive"\s*:\s*"ambiguous"/);
});
