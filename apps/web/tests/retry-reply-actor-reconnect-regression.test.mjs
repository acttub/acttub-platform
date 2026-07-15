import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const migrationPath = (...parts) => path.join(repoRoot, "supabase", "migrations", ...parts);
const followUpMigration = migrationPath("017_reconnect_retry_reply_actor.sql");

function readFollowUpMigration() {
  assert.equal(
    existsSync(followUpMigration),
    true,
    "retry/reply actor reconnect must ship as additive migration 017",
  );
  return readFileSync(followUpMigration, "utf8");
}

test("retry/reply actor reconnect extends immutable acting pipeline migrations", () => {
  const historicalMigrations = new Map([
    ["011_acting_api_pipeline.sql", "69d743df6fe9c3ebd1ddb56355c604e7f542ce1d204933bbdff08315153c2ee6"],
    ["012_canonical_consent_contract.sql", "d9e77e881f8b15614fe549d54a396a753205587976c9489e818a9d5f8beba20d"],
    ["013_scene_context_only.sql", "a2b8b2054d98431397c37bc9605664d2bd98ae168be52bba7421d26f40a01092"],
    ["014_lock_profile_and_terms_owners.sql", "d80d88cdeab177417650b3d2f3a71ee1129e605b3d4cfddf6a9e7b0bb496b629"],
    ["015_canonicalize_consent_versions.sql", "c1158f65016becccf8bd0486fd7be952180fcfe35cc9966e4fdbeb622f6e7467"],
    ["016_bound_practice_inputs.sql", "ac21aa2076373d72975d8d7a153ee60c9bac8652295bb411d099163361b77648"],
  ]);

  for (const [fileName, expectedHash] of historicalMigrations) {
    const contents = readFileSync(migrationPath(fileName));
    assert.equal(createHash("sha256").update(contents).digest("hex"), expectedHash);
  }

  readFollowUpMigration();
});

test("retry claim reconnects the persisted actor row to the new request", () => {
  const sql = readFollowUpMigration();

  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+public\.acttub_claim_coach_reply\s*\(p_session_id\s+uuid,p_user_id\s+uuid,p_run_id\s+uuid,p_request_id\s+uuid,p_request_fingerprint\s+text,p_operation_id\s+uuid,p_actor_turn_id\s+uuid,p_actor_text\s+text,p_retry_actor_turn_id\s+uuid,p_lease_token\s+uuid,p_lease_seconds\s+integer\)/i,
  );
  assert.match(
    sql,
    /p_retry_actor_turn_id\s+is\s+null[\s\S]*char_length\s*\(\s*trim\s*\(\s*p_actor_text\s*\)\s*\)\s*>\s*2000/i,
    "the migration-016 direct-RPC reply limit must survive the replacement",
  );
  assert.match(
    sql,
    /update\s+public\.practice_turns\s+set[\s\S]*?request_id\s*=\s*p_request_id[\s\S]*?where\s+id\s*=\s*p_retry_actor_turn_id/i,
  );
  assert.match(sql, /returning\s+text\s+into\s+p_actor_text/i);
  assert.match(sql, /p_actor_turn_id\s*:=\s*p_retry_actor_turn_id/i);
});

test("coach turn completion enforces exactly one actor only for reply operations", () => {
  const sql = readFollowUpMigration();

  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+public\.acttub_complete_coach_turn\s*\(p_session_id\s+uuid,p_user_id\s+uuid,p_run_id\s+uuid,p_operation_id\s+uuid,p_lease_token\s+uuid,p_acting_session_id\s+text,p_ai_turn_id\s+uuid,p_question\s+text,p_action\s+text,p_focus_timestamp\s+text,p_done\s+boolean,p_close_reason\s+text,p_response_payload\s+jsonb\)/i,
  );
  assert.match(
    sql,
    /select[\s\S]*kind[\s\S]*request_id[\s\S]*from\s+public\.practice_upstream_operations[\s\S]*for\s+update/i,
  );
  assert.match(sql, /get\s+diagnostics\s+\w+\s*=\s*row_count/i);
  assert.match(
    sql,
    /kind[\s\S]*in\s*\(\s*'coach_reply'\s*,\s*'coach_retry_reply'\s*\)[\s\S]*(?:<>|!=)\s*1/i,
  );
  assert.match(sql, /raise\s+exception\s+'coach_actor_turn_cardinality_mismatch'/i);
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.acttub_claim_coach_reply[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  );
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.acttub_claim_coach_reply[\s\S]*to\s+service_role/i,
  );
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.acttub_complete_coach_turn[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  );
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.acttub_complete_coach_turn[\s\S]*to\s+service_role/i,
  );
});
