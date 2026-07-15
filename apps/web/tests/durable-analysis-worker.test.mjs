import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { runAnalysisJobOnce } from "../workers/lib/analysis-job-runner.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("migration 021 exposes the durable lease and CAS RPC contract", () => {
  const path = new URL("../../supabase/migrations/021_durable_analysis_worker.sql", root);
  assert.equal(existsSync(path), true, "migration 021 must exist");
  const sql = readFileSync(path, "utf8");
  for (const rpc of [
    "acttub_enqueue_acting_session",
    "acttub_enqueue_analysis_retry",
    "acttub_claim_next_analysis_job",
    "acttub_extend_analysis_job_lease",
    "acttub_requeue_analysis_job",
  ]) assert.match(sql, new RegExp(rpc));
  assert.match(sql, /for\s+update\s+skip\s+locked/i);
  assert.match(sql, /attempt_count\s*=\s*(?:\w+\.)?attempt_count\s*\+\s*1/i);
});

test("production worker entrypoint is independent Node ESM with once mode", () => {
  assert.equal(existsSync(new URL("workers/analysis-worker.mjs", root)), true);
  assert.equal(existsSync(new URL("workers/lib/analysis-job-runner.mjs", root)), true);
  const worker = read("workers/analysis-worker.mjs");
  const runner = read("workers/lib/analysis-job-runner.mjs");
  assert.match(worker, /--once/);
  assert.match(worker, /SIGTERM/);
  assert.match(runner, /heartbeat/i);
  assert.match(runner, /requeue/i);
  assert.doesNotMatch(runner, /arrayBuffer\(\)|new Blob/);
  assert.match(runner, /createMultipartStream/);
  assert.doesNotMatch(worker + runner, /from\s+["'](?:next|server-only)|src\/server/);
});

const summary = {
  observation: {
    timeline: "t", dialogue: "d", tempo: "t", pitch: "p", movement: "m",
    expression: "e", emotion: "e", extra: [],
  },
  summary: "s", intent_alignment: "i", key_moment: "k", key_dimension: "d", anomalies: [],
};
const job = {
  operation_id: "operation", session_id: "session", user_id: "user",
  analysis_source: {
    storageBucket: "practice-videos",
    storagePath: "users/user/practice-sessions/session/take.mov",
    mimeType: "video/quicktime", situation: "상황", characterContext: "인물", subtext: "의도",
  },
};
const config = {
  leaseMs: 120000, heartbeatMs: 30000, upstreamTimeoutMs: 900000,
  actingApiBaseUrl: "http://acting.test", actingApiKey: "secret", pollMs: 1,
};

test("runner heartbeats a scaled long-running analysis beyond the former timeout boundary and completes through CAS", async () => {
  let heartbeatCount = 0;
  let completed = 0;
  const repository = {
    claim: async () => job,
    heartbeat: async () => { heartbeatCount += 1; return true; },
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => { completed += 1; },
    fail: async () => assert.fail("must not fail"),
    requeue: async () => assert.fail("must not requeue"),
  };
  let calls = 0;
  const scaledConfig = { ...config, heartbeatMs: 5, upstreamTimeoutMs: 100 };
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response(new Uint8Array([1, 2, 3]));
    await new Promise((resolve) => setTimeout(resolve, 35));
    return new Response(JSON.stringify(summary), { status: 200 });
  };
  const result = await runAnalysisJobOnce({ repository, config: scaledConfig, fetchImpl, shutdown: { stopping: false } });
  assert.deepEqual(result, { claimed: true, outcome: "completed" });
  assert.equal(completed, 1);
  assert.ok(heartbeatCount >= 3, `expected repeated heartbeats, received ${heartbeatCount}`);
});

for (const [extension, mimeType] of [["mp4", "video/mp4"], ["mov", "video/quicktime"]]) {
  test(`runner streams canonical ${extension.toUpperCase()} multipart metadata`, async () => {
    const metadataJob = {
      ...job,
      analysis_source: {
        ...job.analysis_source,
        storagePath: `users/user/practice-sessions/session/take.${extension}`,
        mimeType,
      },
    };
    let multipart;
    let calls = 0;
    const repository = {
      claim: async () => metadataJob,
      heartbeat: async () => true,
      createSignedVideoUrl: async () => "http://storage.test/video",
      complete: async () => {},
      fail: async () => assert.fail("must not fail"),
      requeue: async () => assert.fail("must not requeue"),
    };
    const fetchImpl = async (_url, init) => {
      calls += 1;
      if (calls === 1) return new Response(new Uint8Array([1, 2, 3]));
      multipart = { contentType: init.headers["Content-Type"], body: await new Response(init.body).text() };
      return new Response(JSON.stringify(summary), { status: 200 });
    };
    const result = await runAnalysisJobOnce({ repository, config, fetchImpl });
    assert.equal(result.outcome, "completed");
    assert.match(multipart.contentType, /^multipart\/form-data; boundary=/);
    assert.match(multipart.body, new RegExp(`filename="take\\.${extension}"`));
    assert.match(multipart.body, new RegExp(`Content-Type: ${mimeType}`));
  });
}

test("runner requeues transport failures and terminalizes FastAPI 422", async () => {
  const outcomes = [];
  const baseRepository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => assert.fail("must not complete"),
    requeue: async (_id, _token, code) => { outcomes.push(code); return "queued"; },
    fail: async (_job, _token, code) => outcomes.push(code),
  };
  const video = new Response(new Uint8Array([1]));
  let calls = 0;
  const unavailable = await runAnalysisJobOnce({
    repository: baseRepository, config, shutdown: { stopping: false },
    fetchImpl: async () => (++calls === 1 ? video.clone() : new Response("down", { status: 503 })),
  });
  calls = 0;
  const mismatch = await runAnalysisJobOnce({
    repository: baseRepository, config, shutdown: { stopping: false },
    fetchImpl: async () => (++calls === 1 ? video.clone() : new Response("invalid", { status: 422 })),
  });
  assert.equal(unavailable.outcome, "queued");
  assert.equal(mismatch.outcome, "failed");
  assert.deepEqual(outcomes, ["acting_api_unavailable", "acting_api_contract_mismatch"]);
});

test("pre-dispatch source unavailability remains a terminal manual-retry failure", async () => {
  const outcomes = [];
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => assert.fail("must not complete"),
    requeue: async () => assert.fail("G007 source failure must not auto-requeue"),
    fail: async (_job, _token, code) => outcomes.push(code),
  };
  const result = await runAnalysisJobOnce({
    repository, config, shutdown: { stopping: false },
    fetchImpl: async () => new Response("missing", { status: 404 }),
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(outcomes, ["source_video_unavailable"]);
});

test("signed URL generation failure remains terminal even when its adapter marks it retryable", async () => {
  const outcomes = [];
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => { throw Object.assign(new Error("storage unavailable"), { code: "source_video_unavailable", retryable: true }); },
    complete: async () => assert.fail("must not complete"),
    requeue: async () => assert.fail("signed URL source failure must not auto-requeue"),
    fail: async (_job, _token, code) => outcomes.push(code),
  };
  const result = await runAnalysisJobOnce({ repository, config, shutdown: { stopping: false } });
  assert.deepEqual(result, { claimed: true, outcome: "failed", code: "source_video_unavailable" });
  assert.deepEqual(outcomes, ["source_video_unavailable"]);
});

test("graceful shutdown aborts in-flight work into lease recovery without outcome_unknown", async () => {
  const shutdown = { stopping: false, controllers: new Set() };
  let summarizeStarted = false;
  let completed = 0;
  let failed = 0;
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => { completed += 1; },
    fail: async () => { failed += 1; },
    requeue: async () => { throw new Error("stale_analysis_lease"); },
  };
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    if (calls === 1) return new Response(new Uint8Array([1]));
    summarizeStarted = true;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };
  const running = runAnalysisJobOnce({ repository, config, fetchImpl, shutdown });
  while (!summarizeStarted) await new Promise((resolve) => setImmediate(resolve));
  shutdown.stopping = true;
  for (const controller of shutdown.controllers) controller.abort(new DOMException("worker shutdown after grace", "AbortError"));
  const result = await running;
  assert.deepEqual(result, { claimed: true, outcome: "lease_recovery", code: "acting_api_timeout" });
  assert.equal(completed, 0);
  assert.equal(failed, 0);
  assert.equal(shutdown.controllers.size, 0);
});

test("shutdown during the first Storage fetch preserves lease recovery and never terminalizes", async () => {
  const shutdown = { stopping: false, controllers: new Set() };
  let storageStarted = false;
  let failed = 0;
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => assert.fail("must not complete"),
    fail: async () => { failed += 1; },
    requeue: async () => { throw new Error("stale_analysis_lease"); },
  };
  const fetchImpl = async (_url, init) => {
    storageStarted = true;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };
  const running = runAnalysisJobOnce({ repository, config, fetchImpl, shutdown });
  while (!storageStarted) await new Promise((resolve) => setImmediate(resolve));
  shutdown.stopping = true;
  for (const controller of shutdown.controllers) controller.abort(new DOMException("worker shutdown after grace", "AbortError"));
  const result = await running;
  assert.deepEqual(result, { claimed: true, outcome: "lease_recovery", code: "acting_api_timeout" });
  assert.equal(failed, 0);
  assert.equal(shutdown.controllers.size, 0);
});

test("lost lease rejects a late upstream result instead of publishing it", async () => {
  let failed = 0;
  let requeueAttempts = 0;
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => { throw new Error("stale_analysis_lease"); },
    fail: async () => { failed += 1; },
    requeue: async () => { requeueAttempts += 1; throw new Error("stale_analysis_lease"); },
  };
  let calls = 0;
  const fetchImpl = async () => (++calls === 1
    ? new Response(new Uint8Array([1]))
    : new Response(JSON.stringify(summary), { status: 200 }));
  const result = await runAnalysisJobOnce({ repository, config, fetchImpl });
  assert.deepEqual(result, { claimed: true, outcome: "lease_lost" });
  assert.equal(failed, 0);
  assert.equal(requeueAttempts, 0);
});

test("analysis result mismatch remains fatal instead of being requeued", async () => {
  let requeueAttempts = 0;
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    complete: async () => { throw new Error("analysis_result_mismatch"); },
    fail: async () => assert.fail("must not fail"),
    requeue: async () => { requeueAttempts += 1; },
  };
  let calls = 0;
  const fetchImpl = async () => (++calls === 1
    ? new Response(new Uint8Array([1]))
    : new Response(JSON.stringify(summary), { status: 200 }));
  await assert.rejects(runAnalysisJobOnce({ repository, config, fetchImpl }), /analysis_result_mismatch/);
  assert.equal(requeueAttempts, 0);
});

test("trusted probe commits authority before summarize and cleans staged media", async () => {
  const order = [];
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    recordProbe: async (_job, _token, durationMs, version) => order.push(`probe:${durationMs}:${version}`),
    complete: async () => order.push("complete"),
    fail: async () => assert.fail("must not fail"),
    failMediaValidation: async () => assert.fail("must not fail validation"),
    requeue: async () => assert.fail("must not requeue"),
  };
  let calls = 0;
  const result = await runAnalysisJobOnce({
    repository,
    config: { ...config, ffprobePath: "fake", mediaTmpDir: "/tmp" },
    stageAndProbeImpl: async () => ({ durationMs: 180_000, mediaMetadataVersion: "iso-bmff-duration.v1", stream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }) }),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(new Uint8Array([1]));
      order.push("summarize");
      return new Response(JSON.stringify(summary), { status: 200 });
    },
  });
  assert.equal(result.outcome, "completed");
  assert.deepEqual(order, ["probe:180000:iso-bmff-duration.v1", "summarize", "complete"]);
});

for (const [durationMs, expectedCode] of [[180_001, "video_too_long"], [600_000, "video_too_long"]]) {
  test(`trusted ${durationMs}ms bytes override the client report and dispatch zero summaries`, async () => {
    let summarizeCalls = 0;
    const failures = [];
    const repository = {
      claim: async () => ({ ...job, analysis_source: { ...job.analysis_source, reportedDurationMs: 1000 } }),
      heartbeat: async () => true,
      createSignedVideoUrl: async () => "http://storage.test/video",
      recordProbe: async () => assert.fail("over-limit media must not become eligible"),
      complete: async () => assert.fail("must not complete"),
      fail: async () => assert.fail("must use validation failure CAS"),
      failMediaValidation: async (_job, _token, code) => failures.push(code),
      requeue: async () => assert.fail("must not requeue"),
    };
    const result = await runAnalysisJobOnce({
      repository,
      config: { ...config, ffprobePath: "fake", mediaTmpDir: "/tmp" },
      stageAndProbeImpl: async () => ({ durationMs, mediaMetadataVersion: "iso-bmff-duration.v1", stream: () => new ReadableStream() }),
      fetchImpl: async (url) => {
        if (String(url).endsWith("/summarize")) summarizeCalls += 1;
        return new Response(new Uint8Array([1]));
      },
    });
    assert.deepEqual(result, { claimed: true, outcome: "failed", code: expectedCode });
    assert.equal(summarizeCalls, 0);
    assert.deepEqual(failures, [expectedCode]);
  });
}

test("stale probe CAS loses the lease and dispatches zero summaries", async () => {
  let summarizeCalls = 0;
  const repository = {
    claim: async () => job,
    heartbeat: async () => true,
    createSignedVideoUrl: async () => "http://storage.test/video",
    recordProbe: async () => { throw new Error("stale_analysis_lease"); },
    complete: async () => assert.fail("must not complete"),
    fail: async () => assert.fail("must not fail"),
    failMediaValidation: async () => assert.fail("must not fail validation"),
    requeue: async () => assert.fail("must not requeue"),
  };
  const result = await runAnalysisJobOnce({
    repository,
    config: { ...config, ffprobePath: "fake", mediaTmpDir: "/tmp" },
    stageAndProbeImpl: async () => ({ durationMs: 1_000, mediaMetadataVersion: "iso-bmff-duration.v1", stream: () => new ReadableStream() }),
    fetchImpl: async (url) => {
      if (String(url).endsWith("/summarize")) summarizeCalls += 1;
      return new Response(new Uint8Array([1]));
    },
  });
  assert.deepEqual(result, { claimed: true, outcome: "lease_lost" });
  assert.equal(summarizeCalls, 0);
});
