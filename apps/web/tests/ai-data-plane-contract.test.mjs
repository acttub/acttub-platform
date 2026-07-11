import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countReportableActorTurns, validateInterviewCompletionCount, validateReportSectionLineage } from "../src/server/ai-pipeline-runtime-rules.js";

const migration = await readFile(new URL("../../../supabase/migrations/004_ai_pipeline_data_plane.sql", import.meta.url), "utf8");
const migration007 = await readFile(new URL("../../../supabase/migrations/007_ai_pipeline_unknown_turn_count.sql", import.meta.url), "utf8");
const migration008 = await readFile(new URL("../../../supabase/migrations/008_ai_pipeline_session_delete_upload_intent_cleanup.sql", import.meta.url), "utf8");
const migration009 = await readFile(new URL("../../../supabase/migrations/009_ai_pipeline_contract_hardening.sql", import.meta.url), "utf8");
const runtimeRules = await readFile(new URL("../src/server/ai-pipeline-runtime-rules.js", import.meta.url), "utf8");
const service = await readFile(new URL("../src/server/services/ai-pipeline-service.ts", import.meta.url), "utf8");
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
  assert.match(repository,/from\("session_deletion_attempts"\)\.select\("request_id,session_id,user_id,status,storage_deleted,rows_deleted,safe_error_code,attempt,updated_at"\)/);
});

test("repository exposes exact typed transitions and fail-closed row readers",()=>{
  assert.doesNotMatch(repository,/call\(operation|Record<string, unknown>\): Promise/);
  for(const method of ["claimRun","completeSummaryRun","confirmObservation","appendPipelineTurn","completeInterview","completeReportRun","failRun","beginDelete","recordStorageDeleted","completeDelete","failDelete"]) assert.match(repository,new RegExp(`${method}\\(`));
  assert.match(repository,/claimRun\(input:ClaimRunInput\):Promise<ClaimRunResult>\{if\(!isLowerHex64\(input\.requestPayloadFingerprint\)\)throw new AiPipelinePersistenceError\("claimRun","requestPayloadFingerprint"\);const row=await rpc\("acttub_claim_ai_run"/);
  assert.match(repository,/const claimOwned=boolean\(row\.claim_owned,"claimRun","claim_owned"\);const \{claim_owned,\.\.\.runRow\}=row;const run=mapRun\(runRow,"claimRun"\);return\{run,owned:claimOwned\}/);
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
  assert.match(repository, /reportForSession/);
  assert.match(repository, /report\.selectedEvidence/);
  assert.match(repository, /currentSelectedObservationIds/);
  assert.match(repository, /currentSelectedAnswerTurnIds/);
  assert.match(repository, /actorDiscovery[\s\S]*correctionByTurnId/);
  assert.match(repository, /validateReportSectionLineage/);
  assert.match(repository, /sourceRunId !== summaryRun\.id/);
  assert.doesNotMatch(repository, /recordRunModel\(/);
});

test("late audit gates current consent and immutable successful retries",()=>{
  assert.match(migration,/acttub_claim_ai_run[\s\S]*s\.required_consent_version_snapshot=public\.current_acttub_terms_version\(\)[\s\S]*exists\(select 1 from public\.profiles p/);
  assert.match(migration,/acttub_create_pipeline_session[\s\S]*exists\(select 1 from public\.profiles p where p\.id=p_user_id and p\.status='active'[\s\S]*p\.required_consent_at is not null[\s\S]*p\.ai_processing_consent_at is not null/);
  assert.match(migration,/complete_summary_run[\s\S]*if found then return \(select jsonb_build_object\('sessionId'[\s\S]*perform 1 from public\.ai_runs/);
  assert.match(migration,/complete_report_run[\s\S]*if found then return jsonb_build_object\('schemaVersion',existing\.schema_version/);
  assert.doesNotMatch(migration,/existing\.source_run_id<>p_run_id then raise exception 'report_idempotency_conflict'/);
});

test("claim replay hardens on canonical request fingerprint and current summary provenance", () => {
  assert.match(migration009, /create or replace function public\.acttub_claim_ai_run\(p_session_id uuid,p_user_id uuid,p_stage text,p_run_id uuid,p_idempotency_key text,p_max_attempts integer,p_request_schema_version text,p_request_payload_fingerprint text,p_model text,p_prompt_version text\)/);
  assert.match(migration009, /request_payload_conflict/);
  assert.match(repository, /source\.sourceRunId !== summaryRun\.id/);
  assert.match(service, /requestPayloadFingerprint:\s*fingerprintJson\(requestPayload\)/);
  assert.match(service, /requestPayloadFingerprint:\s*fingerprintJson\(reportClaimPayload\(session\)\)/);
});

test("migration 009 replays under lock, expires stale reports, and removes weak overloads", () => {
  const lock = migration009.indexOf("for update;");
  const replay = migration009.indexOf("select r.* into existing");
  const stageGate = migration009.indexOf("if p_stage='summary'");
  assert.ok(lock >= 0 && replay > lock && stageGate > replay);
  assert.match(migration009, /interval '15 minutes'/);
  assert.match(migration009, /REPORT_LEASE_EXPIRED/);
  assert.match(migration009, /existing_run is distinct from p_run_id/);
  assert.match(migration009, /existing\.source_run_id is distinct from p_run_id/);
  assert.match(migration009, /from public,anon,authenticated,service_role;[\s\S]*drop function public\.acttub_claim_ai_run\(uuid,uuid,text,uuid,text,integer,text,text,text\)/);
  assert.match(migration009, /'sessionId',p_session_id,'runId',p_run_id/);
  assert.match(migration009, /invalid_claim_contract/);
  assert.match(migration009, /p_request_schema_version is null or p_model is null or p_prompt_version is null/);
  assert.match(migration009, /existing\.status<>'failed'[\s\S]*session_row\.deletion_status<>'active'[\s\S]*return query update public\.ai_runs/);
  assert.match(migration009, /'AI_TIMEOUT','AI_UNAVAILABLE','AI_INVALID_RESPONSE','AI_INTERNAL','TURN_PERSISTENCE_FAILED','SUMMARY_PERSISTENCE_FAILED','REPORT_PERSISTENCE_FAILED','REPORT_LEASE_EXPIRED'/);
  assert.match(migration009, /p_stage='agent' and \(p_max_attempts<>2/);
  assert.match(migration009, /coalesce\(\(select jsonb_agg/);
  assert.match(migration009, /invalid_tenth_completion/);
  assert.match(migration009, /invalid_agent_completion_payload/);
  assert.match(migration009, /stage='agent' and status='running' and request_schema_version='agent-turn\.v1'/);
  assert.match(migration009, /invalid_agent_completion_contract/);
  assert.match(migration009, /response_schema_version='agent-turn\.v1',response_payload=p_payload->'agentResponse',model=trim\(p_payload->>'model'\),prompt_version=p_payload->>'promptVersion'/);
  assert.match(migration009, /correction_lineage_conflict/);
  assert.match(migration009, /summary_lineage_conflict/);
});

test("service reloads owned Agent progress and sanitizes Summary run output", () => {
  assert.match(service, /const authoritativeSession = await aggregate\(session\.sessionId, userId\)/);
  assert.match(service, /authoritativeSession\.substantiveAnswerCount !== expectedSubstantiveAnswerCount/);
  assert.match(service, /summaryRun:sanitizePublicAiPipelineAggregate\(summaryRun\)/);
  assert.match(service, /run\.promptVersion === "acting-agent\.prompt\.v2"/);
  assert.match(service, /isAgentReplayPayload\(run\.responsePayload\)[\s\S]*run\.responsePayload\.done[\s\S]*run\.responsePayload\.reportReady/);
});

test("run claims require adult participant and authoritative media eligibility",()=>{
  assert.match(migration,/acttub_claim_ai_run[\s\S]*s\.adult_confirmed_at is not null[\s\S]*s\.all_participants_confirmed_at is not null/);
  assert.match(migration,/acttub_claim_ai_run[\s\S]*exists\(select 1 from public\.practice_takes t[\s\S]*t\.duration_ms between 1 and 300000[\s\S]*t\.media_metadata_version='iso-bmff-duration\.v1'/);
});

test("forward migration hardens AI run metadata persistence and mutable confirmations", () => {
  assert.match(migration009, /create or replace function public\.acttub_confirm_observation\(p_session_id uuid,p_user_id uuid,p_observation_id uuid,p_state text,p_correction text default null,p_correction_id uuid default null,p_turn_id uuid default null\)/);
  assert.match(migration009, /add column if not exists request_payload_fingerprint text/);
  assert.match(migration009, /add column if not exists response_payload jsonb/);
  assert.match(migration009, /deletion_status='active' and \(interview_status is null or interview_status in \('active','paused'\)\)/);
  assert.match(migration009, /session_not_mutable/);
  assert.match(migration009, /create or replace function public\.acttub_complete_summary_run\(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_summary jsonb,p_candidates jsonb,p_model text,p_prompt_version text\)/);
  assert.match(migration009, /update public\.ai_runs set status='completed',response_schema_version='summary-response\.v1',model=p_model,prompt_version=p_prompt_version,safe_error_code=null,completed_at=now\(\),updated_at=now\(\)/);
  assert.match(migration009, /create or replace function public\.acttub_append_pipeline_turn\(p_session_id uuid,p_user_id uuid,p_payload jsonb\)/);
  assert.match(migration009, /select count\(\*\) into conversation_count from public\.interview_turns where session_id=p_session_id and user_id=p_user_id and role='actor' and kind in \('answer','unknown'\)/);
  assert.match(migration009, /if conversation_count<>\(p_payload->>'expectedTotalConversationCount'\)::integer then raise exception 'turn_conflict'; end if;/);
  assert.match(migration009, /if conversation_count>=10 then raise exception 'turn_conflict'; end if;/);
  assert.match(migration009, /completionStatus/);
  assert.match(migration009, /completionReason/);
  assert.match(migration009, /interview_status=completion_status_value,completion_reason=completion_reason_value,report_evidence_observation_ids=obs,report_evidence_answer_turn_ids=turns/);
  assert.doesNotMatch(migration009, /model=coalesce\(nullif\(trim\(p_payload->>'model'\),''\),model\)/);
  assert.match(migration009, /update public\.ai_runs set status='completed',response_schema_version='agent-turn\.v1',model=trim\(p_payload->>'model'\),prompt_version=p_payload->>'promptVersion',completed_at=now\(\),updated_at=now\(\)/);
  assert.match(migration009, /create or replace function public\.acttub_complete_interview\(p_session_id uuid,p_user_id uuid,p_payload jsonb\)/);
  assert.match(migration009, /agentRunId/);
  assert.match(migration009, /status='running'/);
  assert.doesNotMatch(migration009, /status in \('running','completed'\)/);
  assert.match(migration009, /create or replace function public\.acttub_complete_report_run\(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_report jsonb,p_model text,p_prompt_version text\)/);
  assert.match(migration009, /update public\.ai_runs set status='completed',response_schema_version='report\.v1',model=p_model,prompt_version=p_prompt_version,completed_at=now\(\),updated_at=now\(\)/);
  assert.match(migration009, /role='actor' and kind in \('answer','unknown'\)/);
  assert.match(migration009, /reason='interview_complete_report_ready' and n<5 and not \(coalesce\(array_length\(last_two_kinds,1\),0\)=2 and last_two_kinds\[1\]='unknown' and last_two_kinds\[2\]='unknown'\)/);
  assert.match(migration009, /reason='hard_limit_report_ready' and conversation_count<>10/);
  assert.match(migration009, /reason='insufficient_interview_evidence' and conversation_count<>10 and n<5 and not \(coalesce\(array_length\(last_two_kinds,1\),0\)=2 and last_two_kinds\[1\]='unknown' and last_two_kinds\[2\]='unknown'\)/);
  assert.doesNotMatch(migration009, /t\.kind='actor_correction'/);
  assert.match(migration009, /primaryReviewPoint[\s\S]*timestampRange'='null'::jsonb/);
  assert.match(migration009, /oneLineSummary[\s\S]*t\.kind='answer'[\s\S]*t\.report_evidence_selected/);
  assert.match(migration009, /actorDiscovery/);
  assert.match(migration009, /groundedEncouragement[\s\S]*jsonb_array_length\(e\.value->'turnEvidenceIds'\)=0/);
  assert.match(migration009, /nextPracticeStep[\s\S]*jsonb_array_length\(e\.value->'observationEvidenceIds'\)\+jsonb_array_length\(e\.value->'turnEvidenceIds'\)=0/);
  assert.match(migration009, /primaryReviewPoint[\s\S]*timestampRange'='null'::jsonb/);
  assert.match(migration009, /oneLineSummary[\s\S]*jsonb_array_length\(e\.value->'turnEvidenceIds'\)=0/);
  assert.match(migration009, /report_run_conflict/);
  assert.match(migration009, /grant execute on function public\.acttub_complete_summary_run\(uuid,uuid,uuid,jsonb,jsonb,text,text\) to service_role/);
  assert.match(migration009, /grant execute on function public\.acttub_complete_report_run\(uuid,uuid,uuid,jsonb,text,text\) to service_role/);
  assert.doesNotMatch(migration009, /coalesce\(nullif\(trim\(p_payload->>'promptVersion'\),''\),prompt_version\)/);
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
  assert.match(runtimeRules, /countReportableActorTurns = \(transcript\)/);
  assert.match(service, /unknownAnswers\.has\(input\.answer\) \? "unknown" : "answer"/);
  assert.match(service, /countReportableActorTurns\(session\.transcript\)/);
  assert.match(service, /substantiveAnswerCount: authoritativeSession\.substantiveAnswerCount \+ \(actorTurn\.kind === "answer" \? 1 : 0\)/);
  assert.match(service, /ensureMutableInterviewSession\(session\)/);
  assert.match(service, /if \(session\.interviewStatus === "completed" \|\| session\.interviewStatus === "completed_without_report"\)[\s\S]*throw new AiPipelineError\(409, "SESSION_NOT_MUTABLE"\);/);
});

test("runtime helpers count answer and unknown turns but exclude corrections", () => {
  const transcript = [
    { role: "actor", kind: "answer" },
    { role: "actor", kind: "unknown" },
    { role: "actor", kind: "actor_correction" },
    { role: "agent", kind: "question" },
  ];
  assert.equal(countReportableActorTurns(transcript), 2);
});

test("runtime helpers enforce interview completion thresholds on reportable and substantive counts", () => {
  assert.doesNotThrow(() => validateInterviewCompletionCount({ reason: "interview_complete_report_ready", substantiveAnswerCount: 5, reportableActorCount: 9 }));
  assert.doesNotThrow(() => validateInterviewCompletionCount({ reason: "hard_limit_report_ready", substantiveAnswerCount: 7, reportableActorCount: 10 }));
  assert.throws(() => validateInterviewCompletionCount({ reason: "hard_limit_report_ready", substantiveAnswerCount: 7, reportableActorCount: 9 }), /invalid_completion_count/);
  assert.doesNotThrow(() => validateInterviewCompletionCount({ reason: "insufficient_interview_evidence", substantiveAnswerCount: 7, reportableActorCount: 9 }));
  assert.throws(() => validateInterviewCompletionCount({ reason: "interview_complete_report_ready", substantiveAnswerCount: 4, reportableActorCount: 10 }), /invalid_completion_count/);
  assert.doesNotThrow(() => validateInterviewCompletionCount({ reason: "interview_complete_report_ready", substantiveAnswerCount: 4, reportableActorCount: 9, lastTwoReportableKinds: ["unknown", "unknown"] }));
  assert.doesNotThrow(() => validateInterviewCompletionCount({ reason: "insufficient_interview_evidence", substantiveAnswerCount: 4, reportableActorCount: 9, lastTwoReportableKinds: ["unknown", "unknown"] }));
});

test("runtime helpers fail closed on report lineage, timestamps, and correction provenance", () => {
  const selectedObservationIds = new Set(["obs-1"]);
  const selectedAnswerIds = new Set(["answer-1"]);
  const selectedAnswerTurnIds = new Set(["answer-1"]);
  const correctionTurnIds = new Set(["cor-1"]);
  const observationSegments = new Map([["obs-1", { startMs: 100, endMs: 200 }]]);
  const correctionSegments = new Map([["cor-1", { startMs: 300, endMs: 350 }]]);
  const primary = { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: [], timestampRange: null };
  assert.throws(() => validateReportSectionLineage({ key: "primaryReviewPoint", section: primary, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /timestampRequired/);
  assert.doesNotThrow(() => validateReportSectionLineage({ key: "primaryReviewPoint", section: { ...primary, timestampRange: { startMs: 100, endMs: 200 } }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }));
  assert.throws(() => validateReportSectionLineage({ key: "primaryReviewPoint", section: { ...primary, timestampRange: { startMs: 1, endMs: 2 } }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_timestamp/);
  assert.doesNotThrow(() => validateReportSectionLineage({ key: "oneLineSummary", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: ["answer-1"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }));
  assert.throws(() => validateReportSectionLineage({ key: "oneLineSummary", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-2"], turnEvidenceIds: ["answer-1"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
  assert.throws(() => validateReportSectionLineage({ key: "oneLineSummary", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: ["cor-1"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
  assert.throws(() => validateReportSectionLineage({ key: "primaryReviewPoint", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: ["cor-1"], timestampRange: { startMs: 300, endMs: 350 } }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
  assert.doesNotThrow(() => validateReportSectionLineage({ key: "groundedEncouragement", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: ["answer-1"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }));
  assert.throws(() => validateReportSectionLineage({ key: "groundedEncouragement", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: ["answer-2"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
  assert.doesNotThrow(() => validateReportSectionLineage({ key: "nextPracticeStep", section: { status: "confirmed", content: "ok", observationEvidenceIds: [], turnEvidenceIds: ["answer-1"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }));
  assert.throws(() => validateReportSectionLineage({ key: "nextPracticeStep", section: { status: "confirmed", content: "ok", observationEvidenceIds: [], turnEvidenceIds: ["cor-1"], timestampRange: { startMs: 300, endMs: 350 } }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
  assert.throws(() => validateReportSectionLineage({ key: "nextPracticeStep", section: { status: "confirmed", content: "ok", observationEvidenceIds: [], turnEvidenceIds: ["cor-2"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
  assert.throws(() => validateReportSectionLineage({ key: "nextPracticeStep", section: { status: "confirmed", content: "ok", observationEvidenceIds: ["obs-1"], turnEvidenceIds: [], timestampRange: { startMs: 1, endMs: 2 } }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_timestamp/);
  assert.throws(() => validateReportSectionLineage({ key: "actorDiscovery", section: { status: "confirmed", content: "ok", observationEvidenceIds: [], turnEvidenceIds: ["answer-2"], timestampRange: null }, selectedObservationIds, selectedAnswerIds, selectedAnswerTurnIds, correctionTurnIds, observationSegments, correctionSegments }), /invalid_report_evidence/);
});

test("forward migration repairs deletion by removing the orphan upload intent and fail-closes the full deletion surface", () => {
  assert.match(migration008, /create or replace function public\.acttub_complete_session_delete/);
  assert.match(migration008, /security definer set search_path=public/);
  assert.match(migration008, /delete from public\.practice_sessions where id=p_session_id and user_id=p_user_id returning upload_intent_id into v_upload_intent_id;/);
  assert.match(migration008, /select id into v_upload_intent_id from public\.upload_intents where session_id=p_session_id and user_id=p_user_id;/);
  assert.match(migration008, /exists\(select 1 from public\.ai_session_summaries where session_id=p_session_id\)/);
  assert.match(migration008, /exists\(select 1 from public\.actor_corrections where session_id=p_session_id\)/);
  assert.match(migration008, /exists\(select 1 from public\.upload_intents where session_id=p_session_id and user_id=p_user_id\)/);
  assert.match(migration008, /delete from public\.upload_intents where id=v_upload_intent_id and user_id=p_user_id and session_id=p_session_id;/);
  assert.match(migration008, /return query update public\.session_deletion_attempts set status='completed',rows_deleted=true,safe_error_code=null,updated_at=now\(\) where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id returning \*;/);
  assert.match(migration008, /revoke execute on function public\.acttub_complete_session_delete\(uuid,uuid,uuid\) from public,anon,authenticated;/);
  assert.match(migration008, /grant execute on function public\.acttub_complete_session_delete\(uuid,uuid,uuid\) to service_role;/);
  assert.match(migration008, /delete_orphan_detected/);
});
