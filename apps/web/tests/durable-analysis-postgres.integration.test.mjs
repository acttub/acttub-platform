import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const sqlScalar = (dbUrl, sql) => execFileSync("psql", [dbUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();

test("trusted acting media probe is lease-fenced, atomic, idempotent, and keeps legacy 300000ms lineage", {
  skip: process.env.G011_RUN_DB_INTEGRATION !== "1" && "set G011_RUN_DB_INTEGRATION=1 with local Supabase running",
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "11000000-0000-0000-0000-000000000001";
  const sessionId = "11000000-0000-0000-0001-000000000001";
  const uploadId = "11000000-0000-0000-0002-000000000001";
  const operationId = "11000000-0000-0000-0003-000000000001";
  const path = `users/${userId}/practice-sessions/${sessionId}/take.mp4`;
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g011-db@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g011-db@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes)
      values('${uploadId}','${userId}','${sessionId}','created','${path}','video/mp4',1024);
  `]);
  const finalized = await client.rpc("acttub_finalize_upload_intent", {
    p_upload_intent_id: uploadId, p_user_id: userId, p_storage_path: path, p_duration_ms: 1000,
  });
  assert.ifError(finalized.error);
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||reported_duration_ms||':'||coalesce(duration_ms::text,'null') from public.upload_intents where id='${uploadId}'`), "validating:1000:null");
  const replay = await client.rpc("acttub_finalize_upload_intent", {
    p_upload_intent_id: uploadId, p_user_id: userId, p_storage_path: path, p_duration_ms: 1000,
  });
  assert.ifError(replay.error);
  const conflict = await client.rpc("acttub_finalize_upload_intent", {
    p_upload_intent_id: uploadId, p_user_id: userId, p_storage_path: path, p_duration_ms: 1001,
  });
  assert.ok(conflict.error);
  const enqueued = await client.rpc("acttub_enqueue_acting_session", {
    p_upload_intent_id: uploadId, p_user_id: userId, p_session_id: sessionId,
    p_take_id: "11000000-0000-0000-0004-000000000001", p_request_id: "11000000-0000-0000-0005-000000000001",
    p_request_fingerprint: "1".repeat(64), p_operation_id: operationId,
    p_medium: "기타", p_genre: "기타", p_situation: "상황", p_character_context: "인물", p_subtext: "의도",
    p_created_at: new Date().toISOString(),
  });
  assert.ifError(enqueued.error);
  assert.equal(sqlScalar(local.DB_URL, `select coalesce(duration_ms::text,'null')||':'||reported_duration_ms from public.practice_takes where session_id='${sessionId}'`), "null:1000");
  const oldClaim = await client.rpc("acttub_claim_next_analysis_job", { p_lease_token: crypto.randomUUID(), p_lease_seconds: 120, p_worker_id: "old" });
  assert.ifError(oldClaim.error);
  assert.deepEqual(oldClaim.data, []);
  const token = crypto.randomUUID();
  const claim = await client.rpc("acttub_claim_next_analysis_job_v2", { p_lease_token: token, p_lease_seconds: 120, p_worker_id: "v2" });
  assert.ifError(claim.error);
  assert.equal(claim.data[0].operation_id, operationId);
  const stale = await client.rpc("acttub_record_trusted_media_probe", {
    p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: crypto.randomUUID(),
    p_authoritative_duration_ms: 180000, p_media_metadata_version: "iso-bmff-duration.v1",
  });
  assert.equal(stale.error?.message.includes("stale_analysis_lease"), true);
  const recordedInput = {
    p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: token,
    p_authoritative_duration_ms: 180000, p_media_metadata_version: "iso-bmff-duration.v1",
  };
  const recorded = await client.rpc("acttub_record_trusted_media_probe", recordedInput);
  assert.ifError(recorded.error);
  const acknowledged = await client.rpc("acttub_record_trusted_media_probe", recordedInput);
  assert.ifError(acknowledged.error);
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||duration_ms||':'||authoritative_duration_ms||':'||(ai_eligible_at is not null) from public.upload_intents where id='${uploadId}'`), "finalized:180000:180000:true");
  assert.equal(sqlScalar(local.DB_URL, `select duration_ms||':'||reported_duration_ms||':'||media_metadata_version from public.practice_takes where session_id='${sessionId}'`), "180000:1000:iso-bmff-duration.v1");
  const mismatch = await client.rpc("acttub_record_trusted_media_probe", { ...recordedInput, p_authoritative_duration_ms: 179999 });
  assert.equal(mismatch.error?.message.includes("media_probe_mismatch"), true);
  assert.match(sqlScalar(local.DB_URL, "select pg_get_functiondef('public.acttub_finalize_ai_upload(uuid,uuid,integer,text)'::regprocedure)"), /between 1 and 300000/u);
  execFileSync("psql", [local.DB_URL, "-c", `delete from auth.users where id='${userId}'`]);
});

test("acting 180001/600000 fail atomically while legacy AI finalize executes 300000 and rejects 300001", {
  skip: process.env.G011_RUN_DB_INTEGRATION !== "1" && "set G011_RUN_DB_INTEGRATION=1 with local Supabase running",
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "12000000-0000-0000-0000-000000000001";
  const sessionId = "12000000-0000-0000-0001-000000000001";
  const uploadId = "12000000-0000-0000-0002-000000000001";
  const operationId = "12000000-0000-0000-0003-000000000001";
  const legacyUploadId = "12000000-0000-0000-0004-000000000001";
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g011-boundaries@example.com',now(),now());
    insert into public.profiles(id,email,status,required_consent_version,required_consent_at,ai_processing_consent_version,ai_processing_consent_at)
      values('${userId}','g011-boundaries@example.com','active',public.current_acttub_terms_version(),now(),public.current_acttub_ai_processing_consent_version(),now());
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,reported_duration_ms)
      values('${uploadId}','${userId}','${sessionId}','validating','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',1024,1000);
    insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
      values('${sessionId}','${userId}','${uploadId}','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
    insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,reported_duration_ms,analysis_status)
      values('12000000-0000-0000-0005-000000000001','${sessionId}','${userId}','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',1024,1000,'pending');
    insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at)
      values('${operationId}','${sessionId}','${userId}','12000000-0000-0000-0006-000000000001',repeat('2',64),'analysis_create','queued',null,null);
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,reported_duration_ms)
      values('12000000-0000-0000-0012-000000000001','${userId}','12000000-0000-0000-0011-000000000001','validating',
      'users/${userId}/practice-sessions/12000000-0000-0000-0011-000000000001/take.mp4','video/mp4',1024,1000);
    insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
      values('12000000-0000-0000-0011-000000000001','${userId}','12000000-0000-0000-0012-000000000001','analyzing','acting-api-v1','기타','기타','orphan','인물','의도');
    insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at,started_at,available_at)
      values('12000000-0000-0000-0013-000000000001','12000000-0000-0000-0011-000000000001','${userId}',
      '12000000-0000-0000-0014-000000000001',repeat('3',64),'analysis_create','queued',null,null,now()-interval '1 minute',now()-interval '1 minute');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,
      required_consent_version_snapshot,ai_processing_consent_version_snapshot,adult_confirmed_at,all_participants_confirmed_at)
      values('${legacyUploadId}','${userId}','12000000-0000-0000-0007-000000000001','created',
      'users/${userId}/practice-sessions/12000000-0000-0000-0007-000000000001/take.mp4','video/mp4',1024,
      public.current_acttub_terms_version(),public.current_acttub_ai_processing_consent_version(),now(),now());
  `]);
  const token = crypto.randomUUID();
  const claim = await client.rpc("acttub_claim_next_analysis_job_v2", { p_lease_token: token, p_lease_seconds: 120, p_worker_id: "boundary" });
  assert.ifError(claim.error);
  assert.equal(claim.data[0].operation_id, operationId, "v2 must skip a queue row whose acting take join is missing");
  assert.equal(sqlScalar(local.DB_URL, "select status from public.practice_upstream_operations where id='12000000-0000-0000-0013-000000000001'"), "queued");
  for (const duration of [180001, 600000]) {
    const rejected = await client.rpc("acttub_record_trusted_media_probe", {
      p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: token,
      p_authoritative_duration_ms: duration, p_media_metadata_version: "iso-bmff-duration.v1",
    });
    assert.equal(rejected.error?.message.includes("invalid_media_metadata"), true);
  }
  const failed = await client.rpc("acttub_fail_trusted_media_validation", {
    p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: token, p_safe_error_code: "video_too_long",
  });
  assert.ifError(failed.error);
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||coalesce(authoritative_duration_ms::text,'null')||':'||coalesce(ai_eligible_at::text,'null') from public.upload_intents where id='${uploadId}'`), "validation_failed:null:null");
  assert.equal(sqlScalar(local.DB_URL, `select analysis_status||':'||analysis_error||':'||analysis_retryable||':'||coalesce(duration_ms::text,'null') from public.practice_takes where session_id='${sessionId}'`), "failed:video_too_long:false:null");
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||safe_error_code||':'||(lease_token is null) from public.practice_upstream_operations where id='${operationId}'`), "failed:video_too_long:true");
  const legacyTooLong = await client.rpc("acttub_finalize_ai_upload", { p_upload_intent_id: legacyUploadId, p_user_id: userId, p_duration_ms: 300001, p_media_metadata_version: "iso-bmff-duration.v1" });
  assert.equal(legacyTooLong.error?.message.includes("invalid_media_metadata"), true);
  const legacyBoundary = await client.rpc("acttub_finalize_ai_upload", { p_upload_intent_id: legacyUploadId, p_user_id: userId, p_duration_ms: 300000, p_media_metadata_version: "iso-bmff-duration.v1" });
  assert.ifError(legacyBoundary.error);
  assert.equal(legacyBoundary.data[0].authoritative_duration_ms, 300000);
  execFileSync("psql", [local.DB_URL, "-c", `delete from auth.users where id='${userId}'`]);
});

test("fresh migrated database supports concurrent analysis claim and stale-token CAS", {
  skip: process.env.G010_RUN_DB_INTEGRATION !== "1" && "set G010_RUN_DB_INTEGRATION=1 with local Supabase running",
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const url = process.env.G010_TEST_SUPABASE_URL ?? local.API_URL;
  const key = process.env.G010_TEST_SUPABASE_SERVICE_ROLE_KEY ?? local.SERVICE_ROLE_KEY;
  const dbUrl = process.env.G010_TEST_DATABASE_URL ?? local.DB_URL;
  const userId = "21000000-0000-0000-0000-000000000001";
  const sessionId = "21000000-0000-0000-0001-000000000001";
  const operationId = "21000000-0000-0000-0002-000000000001";
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", `
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g010-db@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g010-db@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,duration_ms,authoritative_duration_ms,media_metadata_version,ai_eligible_at,finalized_at)
      values('21000000-0000-0000-0003-000000000001','${userId}','${sessionId}','finalized','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',1024,1000,1000,'iso-bmff-duration.v1',now(),now());
    insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
      values('${sessionId}','${userId}','21000000-0000-0000-0003-000000000001','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
    insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,media_metadata_version,analysis_status)
      values('21000000-0000-0000-0004-000000000001','${sessionId}','${userId}','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',1024,1000,'iso-bmff-duration.v1','pending');
    insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at)
      values('${operationId}','${sessionId}','${userId}','21000000-0000-0000-0005-000000000001',repeat('a',64),'analysis_create','queued',null,null);
  `]);

  const client = createClient(url, key, { auth: { persistSession: false } });
  const firstToken = crypto.randomUUID();
  const secondToken = crypto.randomUUID();
  const [first, second] = await Promise.all([
    client.rpc("acttub_claim_next_analysis_job", { p_lease_token: firstToken, p_lease_seconds: 120, p_worker_id: "test-1" }),
    client.rpc("acttub_claim_next_analysis_job", { p_lease_token: secondToken, p_lease_seconds: 120, p_worker_id: "test-2" }),
  ]);
  assert.ifError(first.error);
  assert.ifError(second.error);
  const claimed = [first.data, second.data].filter((rows) => Array.isArray(rows) && rows.length === 1);
  assert.equal(claimed.length, 1, "exactly one concurrent claimant must win");
  const winner = claimed[0][0];
  assert.equal(winner.attempt_count, 1);
  for (const key of ["medium", "genre", "formattedSituation"]) assert.equal(typeof winner.analysis_source[key], "string");
  const winnerToken = winner.lease_token;
  const staleToken = winnerToken === firstToken ? secondToken : firstToken;
  const stale = await client.rpc("acttub_extend_analysis_job_lease", { p_operation_id: operationId, p_lease_token: staleToken, p_lease_seconds: 120 });
  assert.ifError(stale.error);
  assert.equal(stale.data, false);
  const live = await client.rpc("acttub_extend_analysis_job_lease", { p_operation_id: operationId, p_lease_token: winnerToken, p_lease_seconds: 120 });
  assert.ifError(live.error);
  assert.equal(live.data, true);
  const durableAmbiguous = await client.rpc("acttub_fail_analysis", {
    p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId,
    p_lease_token: winnerToken, p_failure_class: "ambiguous", p_safe_error_code: "acting_api_timeout",
  });
  assert.equal(durableAmbiguous.error?.message.includes("invalid_failure_class"), true);
  assert.equal(sqlScalar(dbUrl, `select status from public.practice_upstream_operations where id='${operationId}'`), "in_flight");
  const queued = await client.rpc("acttub_requeue_analysis_job", { p_operation_id: operationId, p_lease_token: winnerToken, p_safe_error_code: "acting_api_unavailable" });
  assert.ifError(queued.error);
  assert.equal(queued.data, "queued");
  const early = await client.rpc("acttub_claim_next_analysis_job", { p_lease_token: crypto.randomUUID(), p_lease_seconds: 120, p_worker_id: "too-early" });
  assert.ifError(early.error);
  assert.deepEqual(early.data, []);
  execFileSync("psql", [dbUrl, "-c", `update public.practice_upstream_operations set available_at=clock_timestamp()-interval '1 second' where id='${operationId}'`]);
  const reclaimedToken = crypto.randomUUID();
  const reclaimed = await client.rpc("acttub_claim_next_analysis_job", { p_lease_token: reclaimedToken, p_lease_seconds: 120, p_worker_id: "requeue-reclaim" });
  assert.ifError(reclaimed.error);
  assert.equal(reclaimed.data[0].attempt_count, 2);
  for (const [rpc, input] of [
    ["acttub_extend_analysis_job_lease", { p_operation_id: operationId, p_lease_token: winnerToken, p_lease_seconds: 120 }],
    ["acttub_requeue_analysis_job", { p_operation_id: operationId, p_lease_token: winnerToken, p_safe_error_code: "acting_api_unavailable" }],
    ["acttub_fail_analysis", { p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: winnerToken, p_failure_class: "definitive", p_safe_error_code: "acting_api_rejected" }],
  ]) {
    const staleResult = await client.rpc(rpc, input);
    if (rpc === "acttub_extend_analysis_job_lease") assert.equal(staleResult.data, false);
    else assert.ok(staleResult.error, `${rpc} must reject a stale token`);
  }
  execFileSync("psql", [dbUrl, "-c", `update public.practice_upstream_operations set lease_expires_at=clock_timestamp()-interval '1 second' where id='${operationId}'`]);
  const expiryToken = crypto.randomUUID();
  const expiryReclaim = await client.rpc("acttub_claim_next_analysis_job", { p_lease_token: expiryToken, p_lease_seconds: 120, p_worker_id: "expiry-reclaim" });
  assert.ifError(expiryReclaim.error);
  assert.equal(expiryReclaim.data[0].attempt_count, 3);
  const staleComplete = await client.rpc("acttub_complete_analysis", { p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: reclaimedToken, p_scene_summary_id: crypto.randomUUID(), p_summary_payload: { summary: "late" } });
  assert.ok(staleComplete.error);
  const sceneSummaryId = "21000000-0000-0000-0006-000000000001";
  const payload = { summary: "winner" };
  const completeInput = { p_session_id: sessionId, p_user_id: userId, p_operation_id: operationId, p_lease_token: expiryToken, p_scene_summary_id: sceneSummaryId, p_summary_payload: payload };
  const completed = await client.rpc("acttub_complete_analysis", completeInput);
  assert.ifError(completed.error);
  const acknowledged = await client.rpc("acttub_complete_analysis", completeInput);
  assert.ifError(acknowledged.error);
  const mismatch = await client.rpc("acttub_complete_analysis", { ...completeInput, p_lease_token: staleToken, p_summary_payload: { summary: "loser" } });
  assert.equal(mismatch.error?.message.includes("analysis_result_mismatch"), true);
  const summaries = await client.from("scene_summaries").select("id,payload").eq("session_id", sessionId);
  assert.ifError(summaries.error);
  assert.deepEqual(summaries.data, [{ id: sceneSummaryId, payload }]);
  const anon = createClient(url, local.ANON_KEY, { auth: { persistSession: false } });
  const denied = await anon.rpc("acttub_extend_analysis_job_lease", { p_operation_id: operationId, p_lease_token: winnerToken, p_lease_seconds: 120 });
  assert.ok(denied.error, "replaced analysis RPCs must remain service-role-only");
  assert.equal(sqlScalar(dbUrl, "select has_table_privilege('service_role','public.profiles','select') and has_table_privilege('service_role','public.profiles','insert')"), "t");
  assert.equal(sqlScalar(dbUrl, "select has_table_privilege('service_role','public.practice_sessions','select') and has_table_privilege('service_role','public.practice_takes','select') and has_table_privilege('service_role','public.scene_summaries','select')"), "t");
  execFileSync("psql", [dbUrl, "-c", `delete from auth.users where id='${userId}'`]);
});

test("fresh migrated database keeps legacy analysis create and retry claims callable", {
  skip: process.env.G010_RUN_DB_INTEGRATION !== "1" && "set G010_RUN_DB_INTEGRATION=1 with local Supabase running",
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "22000000-0000-0000-0000-000000000001";
  const sessionId = "22000000-0000-0000-0001-000000000001";
  const uploadId = "22000000-0000-0000-0002-000000000001";
  const createOperationId = "22000000-0000-0000-0003-000000000001";
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g010-legacy@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g010-legacy@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,duration_ms,finalized_at)
      values('${uploadId}','${userId}','${sessionId}','finalized','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',1024,1000,now());
  `]);
  const created = await client.rpc("acttub_create_acting_session", {
    p_upload_intent_id: uploadId, p_user_id: userId, p_session_id: sessionId,
    p_take_id: "22000000-0000-0000-0004-000000000001",
    p_request_id: "22000000-0000-0000-0005-000000000001", p_request_fingerprint: "a".repeat(64),
    p_operation_id: createOperationId, p_lease_token: "22000000-0000-0000-0006-000000000001",
    p_medium: "기타", p_genre: "기타", p_situation: "상황", p_character_context: "인물", p_subtext: "의도",
    p_lease_seconds: 780, p_created_at: new Date().toISOString(),
  });
  assert.ifError(created.error);
  assert.equal(created.data[0].claim_state, "claimed");
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||attempt_count from public.practice_upstream_operations where id='${createOperationId}'`), "in_flight:0");
  const legacyAmbiguous = await client.rpc("acttub_fail_analysis", {
    p_session_id: sessionId, p_user_id: userId, p_operation_id: createOperationId,
    p_lease_token: "22000000-0000-0000-0006-000000000001", p_failure_class: "ambiguous", p_safe_error_code: "acting_api_timeout",
  });
  assert.ifError(legacyAmbiguous.error);
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||safe_error_code from public.practice_upstream_operations where id='${createOperationId}'`), "outcome_unknown:acting_api_timeout");
  assert.equal(sqlScalar(local.DB_URL, `select analysis_status||':'||analysis_error from public.practice_takes where session_id='${sessionId}'`), "outcome_unknown:acting_api_timeout");
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    update public.practice_upstream_operations set status='failed',lease_token=null,lease_expires_at=null,finished_at=now() where id='${createOperationId}';
    update public.practice_takes set analysis_status='failed',analysis_error='source_video_unavailable',analysis_retryable=true where session_id='${sessionId}';
  `]);
  const retryOperationId = "22000000-0000-0000-0007-000000000001";
  const retried = await client.rpc("acttub_claim_analysis_retry", {
    p_session_id: sessionId, p_user_id: userId,
    p_request_id: "22000000-0000-0000-0008-000000000001", p_request_fingerprint: "b".repeat(64),
    p_operation_id: retryOperationId, p_lease_token: "22000000-0000-0000-0009-000000000001", p_lease_seconds: 780,
  });
  assert.ifError(retried.error);
  assert.equal(retried.data[0].claim_state, "claimed");
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||attempt_count from public.practice_upstream_operations where id='${retryOperationId}'`), "in_flight:0");
  assert.equal(sqlScalar(local.DB_URL, `select analysis_status from public.practice_takes where session_id='${sessionId}'`), "pending");
  execFileSync("psql", [local.DB_URL, "-c", `delete from auth.users where id='${userId}'`]);
});

test("enqueue RPCs are atomic across forced create and retry failures", {
  skip: process.env.G010_RUN_DB_INTEGRATION !== "1" && "set G010_RUN_DB_INTEGRATION=1 with local Supabase running",
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "23000000-0000-0000-0000-000000000001";
  const sessionId = "23000000-0000-0000-0001-000000000001";
  const uploadId = "23000000-0000-0000-0002-000000000001";
  const createOperationId = "23000000-0000-0000-0003-000000000001";
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    drop trigger if exists g010_reject_operation on public.practice_upstream_operations;
    drop function if exists public.g010_reject_operation();
    drop trigger if exists g010_reject_take_reset on public.practice_takes;
    drop function if exists public.g010_reject_take_reset();
    delete from auth.users where id='${userId}';
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g010-atomic@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g010-atomic@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,duration_ms,finalized_at)
      values('${uploadId}','${userId}','${sessionId}','finalized','users/${userId}/practice-sessions/${sessionId}/take.mp4','video/mp4',1024,1000,now());
    create or replace function public.g010_reject_operation() returns trigger language plpgsql as $$begin if new.id='${createOperationId}' then raise exception 'forced_create_rollback'; end if; return new; end$$;
    create trigger g010_reject_operation before insert on public.practice_upstream_operations for each row execute function public.g010_reject_operation();
  `]);
  const createInput = {
    p_upload_intent_id: uploadId, p_user_id: userId, p_session_id: sessionId,
    p_take_id: "23000000-0000-0000-0004-000000000001",
    p_request_id: "23000000-0000-0000-0005-000000000001", p_request_fingerprint: "c".repeat(64),
    p_operation_id: createOperationId, p_medium: "기타", p_genre: "기타", p_situation: "상황",
    p_character_context: "인물", p_subtext: "의도", p_created_at: new Date().toISOString(),
  };
  const rejected = await client.rpc("acttub_enqueue_acting_session", createInput);
  assert.ok(rejected.error);
  assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.practice_sessions where id='${sessionId}'`), "0");
  execFileSync("psql", [local.DB_URL, "-c", "drop trigger g010_reject_operation on public.practice_upstream_operations; drop function public.g010_reject_operation()"]);
  const created = await client.rpc("acttub_enqueue_acting_session", createInput);
  assert.ifError(created.error);
  const createReplay = await client.rpc("acttub_enqueue_acting_session", createInput);
  assert.ifError(createReplay.error);
  assert.equal(createReplay.data[0].operation_id, created.data[0].operation_id);
  assert.equal(createReplay.data[0].session_id, created.data[0].session_id);
  const createConflict = await client.rpc("acttub_enqueue_acting_session", {
    ...createInput,
    p_operation_id: "23000000-0000-0000-0003-000000000002",
    p_request_fingerprint: "e".repeat(64),
  });
  assert.equal(createConflict.error?.message.includes("request_id_conflict"), true);
  assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.practice_sessions where id='${sessionId}'`), "1");
  assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.practice_takes where session_id='${sessionId}'`), "1");
  assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.practice_upstream_operations where session_id='${sessionId}'`), "1");
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    update public.practice_upstream_operations set status='failed',lease_token=null,lease_expires_at=null where id='${createOperationId}';
    update public.practice_takes set analysis_status='failed',analysis_error='source_video_unavailable',analysis_retryable=true where session_id='${sessionId}';
    create or replace function public.g010_reject_take_reset() returns trigger language plpgsql as $$begin if new.session_id='${sessionId}' and new.analysis_status='pending' then raise exception 'forced_retry_rollback'; end if; return new; end$$;
    create trigger g010_reject_take_reset before update on public.practice_takes for each row execute function public.g010_reject_take_reset();
  `]);
  const retryOperationId = "23000000-0000-0000-0006-000000000001";
  const retryInput = { p_session_id: sessionId, p_user_id: userId, p_request_id: "23000000-0000-0000-0007-000000000001", p_request_fingerprint: "d".repeat(64), p_operation_id: retryOperationId };
  const retryRejected = await client.rpc("acttub_enqueue_analysis_retry", retryInput);
  assert.ok(retryRejected.error);
  assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.practice_upstream_operations where id='${retryOperationId}'`), "0");
  assert.equal(sqlScalar(local.DB_URL, `select analysis_status from public.practice_takes where session_id='${sessionId}'`), "failed");
  execFileSync("psql", [local.DB_URL, "-c", "drop trigger g010_reject_take_reset on public.practice_takes; drop function public.g010_reject_take_reset()"]);
  const retried = await client.rpc("acttub_enqueue_analysis_retry", retryInput);
  assert.ifError(retried.error);
  const retryReplay = await client.rpc("acttub_enqueue_analysis_retry", retryInput);
  assert.ifError(retryReplay.error);
  assert.equal(retryReplay.data[0].operation_id, retried.data[0].operation_id);
  assert.equal(retryReplay.data[0].session_id, retried.data[0].session_id);
  const retryConflict = await client.rpc("acttub_enqueue_analysis_retry", {
    ...retryInput,
    p_operation_id: "23000000-0000-0000-0006-000000000003",
    p_request_fingerprint: "f".repeat(64),
  });
  assert.equal(retryConflict.error?.message.includes("request_id_conflict"), true);
  assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.practice_upstream_operations where session_id='${sessionId}' and kind='analysis_retry'`), "1");
  execFileSync("psql", [local.DB_URL, "-c", `update public.practice_upstream_operations set max_attempts=1 where id='${retryOperationId}'`]);
  const exhaustedToken = crypto.randomUUID();
  const exhaustedClaim = await client.rpc("acttub_claim_next_analysis_job_v2", { p_lease_token: exhaustedToken, p_lease_seconds: 120, p_worker_id: "exhaustion" });
  assert.ifError(exhaustedClaim.error);
  assert.equal(exhaustedClaim.data[0].operation_id, retryOperationId);
  const exhausted = await client.rpc("acttub_requeue_analysis_job", { p_operation_id: retryOperationId, p_lease_token: exhaustedToken, p_safe_error_code: "acting_api_unavailable" });
  assert.ifError(exhausted.error);
  assert.equal(exhausted.data, "failed");
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||safe_error_code from public.practice_upstream_operations where id='${retryOperationId}'`), "failed:acting_api_unavailable");
  assert.equal(sqlScalar(local.DB_URL, `select analysis_status||':'||analysis_error||':'||analysis_retryable from public.practice_takes where session_id='${sessionId}'`), "failed:acting_api_unavailable:true");

  const definitiveOperationId = "23000000-0000-0000-0006-000000000002";
  const definitiveRetry = await client.rpc("acttub_enqueue_analysis_retry", {
    ...retryInput,
    p_request_id: "23000000-0000-0000-0007-000000000002",
    p_operation_id: definitiveOperationId,
  });
  assert.ifError(definitiveRetry.error);
  const definitiveToken = crypto.randomUUID();
  const definitiveClaim = await client.rpc("acttub_claim_next_analysis_job_v2", { p_lease_token: definitiveToken, p_lease_seconds: 120, p_worker_id: "definitive" });
  assert.ifError(definitiveClaim.error);
  assert.equal(definitiveClaim.data[0].operation_id, definitiveOperationId);
  const definitive = await client.rpc("acttub_fail_analysis", {
    p_session_id: sessionId, p_user_id: userId, p_operation_id: definitiveOperationId,
    p_lease_token: definitiveToken, p_failure_class: "definitive", p_safe_error_code: "source_video_unavailable",
  });
  assert.ifError(definitive.error);
  assert.equal(sqlScalar(local.DB_URL, `select status||':'||safe_error_code from public.practice_upstream_operations where id='${definitiveOperationId}'`), "failed:source_video_unavailable");
  assert.equal(sqlScalar(local.DB_URL, `select analysis_status||':'||analysis_error||':'||analysis_retryable from public.practice_takes where session_id='${sessionId}'`), "failed:source_video_unavailable:true");
  execFileSync("psql", [local.DB_URL, "-c", `delete from auth.users where id='${userId}'`]);
});
