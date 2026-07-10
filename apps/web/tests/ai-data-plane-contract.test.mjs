import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../../supabase/migrations/004_ai_pipeline_data_plane.sql", import.meta.url), "utf8");
const migration007 = await readFile(new URL("../../../supabase/migrations/007_ai_pipeline_unknown_turn_count.sql", import.meta.url), "utf8");
const repository = await readFile(new URL("../src/server/repositories/supabase-ai-pipeline-repository.ts", import.meta.url), "utf8");
const types = await readFile(new URL("../src/server/repositories/ai-pipeline-types.ts", import.meta.url), "utf8");

test("migration implements every transaction boundary instead of payload-only stubs", () => {
  for (const name of ["create_pipeline_session","claim_ai_run","complete_summary_run","confirm_observation","append_pipeline_turn","complete_interview","complete_report_run","fail_ai_run","begin_session_delete","record_storage_deleted","complete_session_delete","fail_session_delete"]) assert.match(migration,new RegExp(`acttub_${name}`));
  assert.match(migration,/complete_summary_run[\s\S]*insert into public\.ai_session_summaries[\s\S]*insert into public\.observations[\s\S]*update public\.ai_runs/);
  assert.match(migration,/append_pipeline_turn[\s\S]*insert into public\.interview_turns[\s\S]*update public\.practice_sessions/);
  assert.match(migration,/complete_report_run[\s\S]*insert into public\.ai_reports[\s\S]*update public\.ai_runs/);
  assert.doesNotMatch(migration,/Remaining payload-heavy boundaries accept typed JSON documents/);
});

test("migration preserves legacy consent and enforces isolation/idempotency",()=>{
  assert.match(migration,/active_profile_requires_current_consent[\s\S]*not valid/);
  assert.match(migration,/observations_one_accepted_uidx/);
  assert.match(migration,/delete_request_conflict/);
  assert.match(migration,/storage_not_verified/);
  assert.match(migration,/as restrictive[\s\S]*deletion_status='active'/);
  assert.match(migration,/grant execute on function public\.acttub_create_pipeline_session\(uuid,uuid,uuid,uuid,jsonb\)/);
});

test("repository exposes exact typed transitions and fail-closed row readers",()=>{
  assert.doesNotMatch(repository,/call\(operation|Record<string, unknown>\): Promise/);
  for(const method of ["claimRun","completeSummaryRun","confirmObservation","appendPipelineTurn","completeInterview","completeReportRun","failRun","beginDelete","recordStorageDeleted","completeDelete","failDelete"]) assert.match(repository,new RegExp(`${method}\\(`));
  assert.match(repository,/Invalid AI pipeline persistence result/);
  assert.match(types,/NormalizedSummary/);
  assert.match(types,/correctsObservationId: string; segment: Segment; text: string; correctionByTurnId/);
});

test("final audit defects are guarded fail closed", () => {
  assert.match(migration, /required_consent_version_snapshot=public\.current_acttub_terms_version\(\)/);
  assert.match(migration, /ai_processing_consent_version_snapshot=public\.current_acttub_ai_processing_consent_version\(\)/);
  assert.match(migration, /complete_summary_run[\s\S]*normalizedSummary[\s\S]*observationCandidates/);
  assert.match(migration, /jsonb_array_length\(p_candidates\)<>jsonb_array_length\(p_summary->'anomalies'\)/);
  assert.match(migration, /summary_subtext_mismatch/);
  assert.match(migration, /expected_start:=least/);
  assert.match(migration, /invalid_current_input/);
  assert.match(migration, /duplicate_report_evidence/);
  assert.match(migration, /invalid_completion_count/);
  assert.match(migration, /evidence_not_allowed/);
  assert.doesNotMatch(migration, /report_idempotency_conflict/);
  assert.match(migration, /return jsonb_build_object\('schemaVersion',existing\.schema_version/);
  assert.match(migration, /invalid_unconfirmed_section/);
  assert.match(migration, /invalid_report_timestamp/);
  assert.match(migration, /DELETE_VERIFICATION_FAILED/);
  assert.match(migration, /delete_orphan_detected/);
  assert.match(migration, /where session_deletion_attempts\.session_id=p_session_id/);
});

test("repository deeply checks summary report and run invariants", () => {
  assert.match(repository, /normalizedSummary\.observation\.extra/);
  assert.match(repository, /normalizedSummary\.noSubtext/);
  assert.match(repository, /timestampOrder/);
  assert.match(repository, /notConfirmed/);
  assert.match(repository, /run\.invariants/);
  assert.match(repository, /report\.invariants/);
});

test("late audit gates current consent and immutable successful retries",()=>{
  assert.match(migration,/acttub_claim_ai_run[\s\S]*s\.required_consent_version_snapshot=public\.current_acttub_terms_version\(\)[\s\S]*exists\(select 1 from public\.profiles p/);
  assert.match(migration,/acttub_create_pipeline_session[\s\S]*exists\(select 1 from public\.profiles p where p\.id=p_user_id and p\.status='active'[\s\S]*p\.required_consent_at is not null[\s\S]*p\.ai_processing_consent_at is not null/);
  assert.match(migration,/complete_summary_run[\s\S]*if found then return \(select jsonb_build_object\('sessionId'[\s\S]*perform 1 from public\.ai_runs/);
  assert.match(migration,/complete_report_run[\s\S]*if found then return jsonb_build_object\('schemaVersion',existing\.schema_version/);
  assert.doesNotMatch(migration,/existing\.source_run_id<>p_run_id then raise exception 'report_idempotency_conflict'/);
});

test("run claims require adult participant and authoritative media eligibility",()=>{
  assert.match(migration,/acttub_claim_ai_run[\s\S]*s\.adult_confirmed_at is not null[\s\S]*s\.all_participants_confirmed_at is not null/);
  assert.match(migration,/acttub_claim_ai_run[\s\S]*exists\(select 1 from public\.practice_takes t[\s\S]*t\.duration_ms between 1 and 300000[\s\S]*t\.media_metadata_version='iso-bmff-duration\.v1'/);
});

test("late audit rejects malformed deep summary values and accepts typed answer or unknown turns",()=>{
  assert.match(migration,/invalid_summary_nullable/);
  assert.match(migration,/jsonb_typeof\(a->'overlapsKeyMoment'\) not in \('null','boolean'\)/);
  assert.match(migration,/invalid_summary_anomaly_range/);
  assert.match(migration,/actor->>'kind' not in \('answer','unknown'\)/);
  assert.match(repository,/anomaly\[\$\{i\}\]\.range/);
  assert.match(repository,/anomaly\.boolean/);
  assert.match(repository,/anomaly\.intentImpact/);
  assert.match(repository,/anomaly\[\$\{i\}\]\.noSubtext/);
});

test("forward migration preserves unknown actor turns without incrementing substantive answers", () => {
  assert.match(migration007, /create or replace function public\.acttub_append_pipeline_turn/);
  assert.match(migration007, /if actor->>'kind'='answer' then expected:=expected\+1; end if; end if;/);
});
