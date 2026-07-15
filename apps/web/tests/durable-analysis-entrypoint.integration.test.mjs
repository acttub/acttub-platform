import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
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
  skip: process.env.G010_RUN_DB_INTEGRATION !== "1" && "set G010_RUN_DB_INTEGRATION=1 with local Supabase running",
  timeout: 20_000,
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "22000000-0000-0000-0000-000000000001";
  const sessionId = "22000000-0000-0000-0001-000000000001";
  const storagePath = `users/${userId}/practice-sessions/${sessionId}/take.mp4`;
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g010-worker@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g010-worker@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,duration_ms,finalized_at)
      values('22000000-0000-0000-0003-000000000001','${userId}','${sessionId}','finalized','${storagePath}','video/mp4',3,1000,now());
    insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
      values('${sessionId}','${userId}','22000000-0000-0000-0003-000000000001','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
    insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,analysis_status)
      values('22000000-0000-0000-0004-000000000001','${sessionId}','${userId}','${storagePath}','video/mp4',3,1000,'pending');
    insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at)
      values('22000000-0000-0000-0002-000000000001','${sessionId}','${userId}','22000000-0000-0000-0005-000000000001',repeat('b',64),'analysis_create','queued',null,null);
  `]);
  const upload = await client.storage.from("practice-videos").upload(storagePath, new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }));
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
  };
  try {
    const first = await run(repoRoot, env);
    assert.equal(first.code, 0, first.output);
    assert.equal(summarizeCalls, 1);
    const operation = await client.from("practice_upstream_operations").select("status,lease_token").eq("id", "22000000-0000-0000-0002-000000000001").single();
    assert.ifError(operation.error);
    assert.deepEqual(operation.data, { status: "completed", lease_token: null });
    const second = await run(repoRoot, env);
    assert.equal(second.code, 0, second.output);
    assert.equal(summarizeCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await client.storage.from("practice-videos").remove([storagePath]);
    execFileSync("psql", [local.DB_URL, "-c", `delete from auth.users where id='${userId}'`]);
  }
});
