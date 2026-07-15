import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const summary = {
  observation: { timeline: "t", dialogue: "d", tempo: "t", pitch: "p", movement: "m", expression: "e", emotion: "e", extra: [] },
  summary: "s", intent_alignment: "i", key_moment: "k", key_dimension: "d", anomalies: [],
};

const run = (cwd, env) => new Promise((resolve) => {
  const child = spawn("pnpm", ["worker:analysis:once"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.once("exit", (code) => resolve({ code, output }));
});

test("real worker once entrypoint completes one job then no-ops", {
  skip: process.env.G011_RUN_DB_INTEGRATION !== "1" && "set G011_RUN_DB_INTEGRATION=1 with local Supabase running",
  timeout: 120_000,
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "22000000-0000-0000-0000-000000000001";
  const sessionId = "22000000-0000-0000-0001-000000000001";
  const storagePath = `users/${userId}/practice-sessions/${sessionId}/take.mp4`;
  const corruptSessionId = "22000000-0000-0000-0011-000000000001";
  const corruptPath = `users/${userId}/practice-sessions/${corruptSessionId}/take.mp4`;
  const overSessionId = "22000000-0000-0000-0021-000000000001";
  const overPath = `users/${userId}/practice-sessions/${overSessionId}/take.mp4`;
  const fixture = new URL("fixtures/media/valid-180000ms.mp4", import.meta.url);
  const corruptFixture = new URL("fixtures/media/corrupt-truncated.mp4", import.meta.url);
  const overFixture = new URL("fixtures/media/valid-600000ms.mp4", import.meta.url);
  const fixtureSize = statSync(fixture).size;
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g010-worker@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g010-worker@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,reported_duration_ms)
      values('22000000-0000-0000-0003-000000000001','${userId}','${sessionId}','validating','${storagePath}','video/mp4',${fixtureSize},1000);
    insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
      values('${sessionId}','${userId}','22000000-0000-0000-0003-000000000001','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
    insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,reported_duration_ms,analysis_status)
      values('22000000-0000-0000-0004-000000000001','${sessionId}','${userId}','${storagePath}','video/mp4',${fixtureSize},null,1000,'pending');
    insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at)
      values('22000000-0000-0000-0002-000000000001','${sessionId}','${userId}','22000000-0000-0000-0005-000000000001',repeat('b',64),'analysis_create','queued',null,null);
  `]);
  const upload = await client.storage.from("practice-videos").upload(storagePath, new Blob([readFileSync(fixture)], { type: "video/mp4" }));
  assert.ifError(upload.error);

  let summarizeCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === "/summarize") {
      summarizeCalls += 1;
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(summary));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const repoRoot = new URL("../../..", import.meta.url).pathname;
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    ACTING_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    ACTING_API_KEY: "test-key",
    ANALYSIS_WORKER_LEASE_MS: "30000",
    ANALYSIS_WORKER_HEARTBEAT_MS: "5000",
    ANALYSIS_WORKER_UPSTREAM_TIMEOUT_MS: "10000",
    ANALYSIS_WORKER_FFPROBE_PATH: process.env.ANALYSIS_WORKER_FFPROBE_PATH,
    ANALYSIS_WORKER_MEDIA_TMP_DIR: new URL("fixtures/media", import.meta.url).pathname,
  };
  try {
    const first = await run(repoRoot, env);
    assert.equal(first.code, 0, first.output);
    assert.equal(summarizeCalls, 1);
    const operation = await client.from("practice_upstream_operations").select("status,lease_token").eq("id", "22000000-0000-0000-0002-000000000001").single();
    assert.ifError(operation.error);
    assert.deepEqual(operation.data, { status: "completed", lease_token: null });
    const authority = await client.from("upload_intents").select("duration_ms,authoritative_duration_ms,media_metadata_version,ai_eligible_at,status").eq("id", "22000000-0000-0000-0003-000000000001").single();
    assert.ifError(authority.error);
    assert.equal(authority.data.duration_ms, 180000);
    assert.equal(authority.data.authoritative_duration_ms, 180000);
    assert.equal(authority.data.media_metadata_version, "iso-bmff-duration.v1");
    assert.equal(authority.data.status, "finalized");
    assert.ok(authority.data.ai_eligible_at);
    const second = await run(repoRoot, env);
    assert.equal(second.code, 0, second.output);
    assert.equal(summarizeCalls, 1);
    execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
      insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,reported_duration_ms)
        values('22000000-0000-0000-0013-000000000001','${userId}','${corruptSessionId}','validating','${corruptPath}','video/mp4',${statSync(corruptFixture).size},1000);
      insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
        values('${corruptSessionId}','${userId}','22000000-0000-0000-0013-000000000001','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
      insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,reported_duration_ms,analysis_status)
        values('22000000-0000-0000-0014-000000000001','${corruptSessionId}','${userId}','${corruptPath}','video/mp4',${statSync(corruptFixture).size},null,1000,'pending');
      insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at)
        values('22000000-0000-0000-0012-000000000001','${corruptSessionId}','${userId}','22000000-0000-0000-0015-000000000001',repeat('c',64),'analysis_create','queued',null,null);
    `]);
    const corruptUpload = await client.storage.from("practice-videos").upload(corruptPath, new Blob([readFileSync(corruptFixture)], { type: "video/mp4" }));
    assert.ifError(corruptUpload.error);
    const corruptRun = await run(repoRoot, env);
    assert.equal(corruptRun.code, 0, corruptRun.output);
    assert.equal(summarizeCalls, 1, "corrupt media must dispatch zero summarize requests");
    const corruptTake = await client.from("practice_takes").select("duration_ms,analysis_status,analysis_error,analysis_retryable").eq("session_id", corruptSessionId).single();
    assert.ifError(corruptTake.error);
    assert.deepEqual(corruptTake.data, { duration_ms: null, analysis_status: "failed", analysis_error: "source_video_metadata_invalid", analysis_retryable: false });
    assert.equal((await client.from("upload_intents").select("status,ai_eligible_at").eq("session_id", corruptSessionId).single()).data.status, "validation_failed");
    execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
      insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,reported_duration_ms)
        values('22000000-0000-0000-0023-000000000001','${userId}','${overSessionId}','validating','${overPath}','video/mp4',${statSync(overFixture).size},1000);
      insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
        values('${overSessionId}','${userId}','22000000-0000-0000-0023-000000000001','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
      insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,reported_duration_ms,analysis_status)
        values('22000000-0000-0000-0024-000000000001','${overSessionId}','${userId}','${overPath}','video/mp4',${statSync(overFixture).size},null,1000,'pending');
      insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at)
        values('22000000-0000-0000-0022-000000000001','${overSessionId}','${userId}','22000000-0000-0000-0025-000000000001',repeat('d',64),'analysis_create','queued',null,null);
    `]);
    const overUpload = await client.storage.from("practice-videos").upload(overPath, new Blob([readFileSync(overFixture)], { type: "video/mp4" }));
    assert.ifError(overUpload.error);
    const overRun = await run(repoRoot, env);
    assert.equal(overRun.code, 0, overRun.output);
    assert.equal(summarizeCalls, 1, "600000ms bytes reported as 1000ms must dispatch zero summarize requests");
    assert.deepEqual((await client.from("practice_takes").select("analysis_error,analysis_retryable,duration_ms").eq("session_id", overSessionId).single()).data,
      { analysis_error: "video_too_long", analysis_retryable: false, duration_ms: null });
    assert.deepEqual((await client.from("upload_intents").select("status,authoritative_duration_ms,ai_eligible_at").eq("session_id", overSessionId).single()).data,
      { status: "validation_failed", authoritative_duration_ms: null, ai_eligible_at: null });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await client.storage.from("practice-videos").remove([storagePath, corruptPath, overPath]);
    execFileSync("psql", [local.DB_URL, "-c", `delete from auth.users where id='${userId}'`]);
  }
});
