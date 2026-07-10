import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../../supabase/migrations/004_ai_pipeline_data_plane.sql", import.meta.url), "utf8");
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
  assert.match(migration, /summary_idempotency_conflict/);
  assert.match(migration, /jsonb_array_length\(p_candidates\)<>jsonb_array_length\(p_summary->'anomalies'\)/);
  assert.match(migration, /summary_subtext_mismatch/);
  assert.match(migration, /expected_start:=least/);
  assert.match(migration, /invalid_current_input/);
  assert.match(migration, /duplicate_report_evidence/);
  assert.match(migration, /invalid_completion_count/);
  assert.match(migration, /evidence_not_allowed/);
  assert.match(migration, /report_idempotency_conflict/);
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
