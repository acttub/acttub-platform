import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.G012_RUN_DB_INTEGRATION === "1";
const localStatus = () => JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
const psql = (db, sql) => execFileSync("psql", [db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
const createInput = (userId, index, bytes = 10, requestId = `24000000-0000-0000-0010-${String(index).padStart(12, "0")}`) => {
  const sessionId = `24000000-0000-0000-0020-${String(index).padStart(12, "0")}`;
  return { p_user_id: userId, p_request_id: requestId, p_request_fingerprint: String(index % 10).repeat(64), p_upload_intent_id: `24000000-0000-0000-0030-${String(index).padStart(12, "0")}`, p_session_id: sessionId, p_storage_bucket: "practice-videos", p_storage_path: `users/${userId}/practice-sessions/${sessionId}/take.mp4`, p_mime_type: "video/mp4", p_size_bytes: bytes, p_expires_at: new Date(Date.now() + 7200000).toISOString() };
};

test("concurrent creates enforce count and replay, and only cleanup completion returns quota", { skip: !enabled, timeout: 30000 }, async () => {
  const local = localStatus(); const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "24000000-0000-0000-0000-000000000001";
  psql(local.DB_URL, `update public.upload_quota_policy set max_active_intents=5,max_active_bytes=1153433600; insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g012-count@example.com',now(),now()); insert into public.profiles(id,email,status) values('${userId}','g012-count@example.com','pending_terms');`);
  try {
    const inputs = Array.from({ length: 10 }, (_, index) => createInput(userId, index + 1));
    const results = await Promise.all(inputs.map((input) => client.rpc("acttub_create_upload_intent", input)));
    assert.equal(results.filter((result) => !result.error).length, 5);
    assert.equal(results.filter((result) => result.error?.message.includes("upload_quota_exceeded")).length, 5);
    const replay = await client.rpc("acttub_create_upload_intent", inputs.find((_, index) => !results[index].error)); assert.ifError(replay.error);
    const existing = psql(local.DB_URL, `select id from public.upload_intents where user_id='${userId}' order by id limit 1`);
    psql(local.DB_URL, `update public.upload_intents set expires_at=now()-interval '31 minutes' where id='${existing}'`);
    const token = crypto.randomUUID(); const claim = await client.rpc("acttub_claim_upload_cleanup_jobs", { p_lease_token: token, p_lease_seconds: 120, p_batch_size: 1, p_worker_id: "integration" }); assert.ifError(claim.error); assert.equal(claim.data.length, 1);
    assert.equal(Number(psql(local.DB_URL, `select count(*) from public.upload_intents where user_id='${userId}' and consumed_at is null and cleanup_completed_at is null`)), 5, "claim must not release quota");
    const complete = await client.rpc("acttub_complete_upload_cleanup", { p_job_id: claim.data[0].id, p_lease_token: token, p_object_existed: false, p_cleaned_size_bytes: null }); assert.ifError(complete.error);
    const after = await client.rpc("acttub_create_upload_intent", createInput(userId, 99)); assert.ifError(after.error);
  } finally { psql(local.DB_URL, `delete from auth.users where id='${userId}'; update public.upload_quota_policy set max_active_intents=5,max_active_bytes=1153433600;`); }
});

test("concurrent actual-byte observation is committed, fenced, and blocks later creates until cleanup", { skip: !enabled, timeout: 30000 }, async () => {
  const local = localStatus(); const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "24000000-0000-0000-0000-000000000002";
  psql(local.DB_URL, `insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g012-bytes@example.com',now(),now()); insert into public.profiles(id,email,status) values('${userId}','g012-bytes@example.com','pending_terms'); update public.upload_quota_policy set max_active_intents=20,max_active_bytes=100;`);
  try {
    const base = createInput(userId, 201, 1); assert.ifError((await client.rpc("acttub_create_upload_intent", base)).error);
    assert.ifError((await client.rpc("acttub_create_upload_intent", createInput(userId, 200, 95))).error);
    const [observed, created] = await Promise.all([
      client.rpc("acttub_observe_upload_object", { p_upload_intent_id: base.p_upload_intent_id, p_user_id: userId, p_actual_size_bytes: 10, p_actual_mime_type: "video/mp4" }),
      client.rpc("acttub_create_upload_intent", createInput(userId, 202, 5)),
    ]);
    assert.equal(observed.data, "upload_quota_exceeded");
    assert.equal(Number(psql(local.DB_URL, `select actual_size_bytes from public.upload_intents where id='${base.p_upload_intent_id}'`)), 10);
    assert.equal(psql(local.DB_URL, `select status from public.upload_intents where id='${base.p_upload_intent_id}'`), "validation_failed");
    assert.match(created.error?.message ?? "", /upload_quota_exceeded/, "serialized concurrent create is deterministically rejected");
    const blocked = await client.rpc("acttub_create_upload_intent", createInput(userId, 203, 5)); assert.match(blocked.error?.message ?? "", /upload_quota_exceeded/);
    psql(local.DB_URL, `update public.upload_cleanup_jobs set available_at=now() where upload_intent_id='${base.p_upload_intent_id}'`);
    const token = crypto.randomUUID(); const claim = await client.rpc("acttub_claim_upload_cleanup_job", { p_upload_intent_id: base.p_upload_intent_id, p_lease_token: token, p_lease_seconds: 30, p_worker_id: "integration" }); assert.ifError(claim.error); assert.equal(claim.data.length, 1);
    assert.equal(Number(psql(local.DB_URL, `select coalesce(sum(coalesce(actual_size_bytes,expected_size_bytes)),0) from public.upload_intents where user_id='${userId}' and consumed_at is null and cleanup_completed_at is null`)), 105);
    assert.ifError((await client.rpc("acttub_complete_upload_cleanup", { p_job_id: claim.data[0].id, p_lease_token: token, p_object_existed: false, p_cleaned_size_bytes: null })).error);
    const admitted = await client.rpc("acttub_create_upload_intent", createInput(userId, 204, 5)); assert.ifError(admitted.error);
  } finally { psql(local.DB_URL, `delete from auth.users where id='${userId}'; update public.upload_quota_policy set max_active_intents=5,max_active_bytes=1153433600;`); }
});

test("reachable session consumption serializes against an exact cleanup claim", { skip: !enabled, timeout: 30000 }, async () => {
  const local = localStatus(); const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "24000000-0000-0000-0000-000000000003", uploadId = "24000000-0000-0000-0030-000000000301", sessionId = "24000000-0000-0000-0020-000000000301", finalizeUploadId = "24000000-0000-0000-0030-000000000302", finalizeSessionId = "24000000-0000-0000-0020-000000000302";
  const finalizePath = `users/${userId}/practice-sessions/${finalizeSessionId}/take.mp4`;
  psql(local.DB_URL, `insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g012-race@example.com',now(),now()); insert into public.profiles(id,email,status) values('${userId}','g012-race@example.com','pending_terms'); insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at) values('${uploadId}','${userId}','${sessionId}','created','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',10,now()+interval '1 hour'),('${finalizeUploadId}','${userId}','${finalizeSessionId}','created','${finalizePath}','video/mp4',10,now()+interval '1 hour'); insert into public.upload_cleanup_jobs(upload_intent_id,reason,status,available_at) values('${uploadId}','expired_unfinalized','queued',now()),('${finalizeUploadId}','expired_unfinalized','queued',now());`);
  try {
    const finalizeLease = crypto.randomUUID();
    const [finalize, finalizeClaim] = await Promise.all([
      client.rpc("acttub_finalize_upload_intent", { p_upload_intent_id: finalizeUploadId, p_user_id: userId, p_storage_path: finalizePath, p_duration_ms: 1000 }),
      client.rpc("acttub_claim_upload_cleanup_job", { p_upload_intent_id: finalizeUploadId, p_lease_token: finalizeLease, p_lease_seconds: 30, p_worker_id: "finalize-race" }),
    ]);
    assert.ifError(finalize.error);
    assert.ifError(finalizeClaim.error);
    assert.equal(finalizeClaim.data.length, 0, "future finalize target is rechecked and never leased");
    assert.equal(psql(local.DB_URL, `select status from public.upload_intents where id='${finalizeUploadId}'`), "validating");
    const lease = crypto.randomUUID();
    const [consume, claim] = await Promise.all([
      client.rpc("acttub_create_session_from_upload_intent", {
        p_upload_intent_id: uploadId, p_user_id: userId, p_session_id: sessionId,
        p_take_id: "24000000-0000-0000-0040-000000000301", p_observation_id: "24000000-0000-0000-0050-000000000301", p_first_question_id: "24000000-0000-0000-0060-000000000301",
        p_medium: "기타", p_genre: "기타", p_situation: "상황", p_character_context: "인물", p_subtext: "의도", p_duration_ms: 1000,
        p_observation_text: "관찰", p_observation_confidence: 0.9, p_observation_timestamp_start_ms: 0, p_observation_timestamp_end_ms: 1000,
        p_first_question_content: "질문", p_first_question_focus: "초점", p_first_question_source_observation_ids: ["24000000-0000-0000-0050-000000000301"], p_created_at: new Date().toISOString(),
      }),
      client.rpc("acttub_claim_upload_cleanup_job", { p_upload_intent_id: uploadId, p_lease_token: lease, p_lease_seconds: 30, p_worker_id: "race" }),
    ]);
    assert.ifError(consume.error);
    assert.ifError(claim.error);
    assert.equal(claim.data.length, 0, "future live intent is rechecked and never leased even with a queued job");
    assert.equal(psql(local.DB_URL, `select (consumed_at is not null)::text||':'||status from public.upload_intents where id='${uploadId}'`), "true:finalized");
    assert.equal(psql(local.DB_URL, `select count(*) from public.practice_sessions where id='${sessionId}' and upload_intent_id='${uploadId}'`), "1");
  } finally { psql(local.DB_URL, `delete from auth.users where id='${userId}'`); }
});
