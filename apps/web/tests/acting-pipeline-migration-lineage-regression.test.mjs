import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const migrationPath = (...parts) => path.join(repoRoot, "supabase", "migrations", ...parts);

test("acting-api migrations extend the deployed AI pipeline lineage", () => {
  const historicalMigrations = new Map([
    ["004_ai_pipeline_data_plane.sql", "fb345afce506086e4877300dd2ae7b4e4e1820a5797eb35d72e0697fa6f2ca36"],
    ["005_close_ai_table_select_privilege_gaps.sql", "e1fcbdac50bf81790de80b4e8b17dd1a1cde7df30f14704d769e35c09dc14fce"],
    ["006_pipeline_security_advisor_hardening.sql", "a9648afc32ad4876c069aaca9d1400123c9d8396532da99be7aa4c1ba7874dfc"],
    ["007_ai_pipeline_unknown_turn_count.sql", "05c05c0e89e52ffb9ab805fe176f7db8fab6a8feb5f87ff5bdf38acbb38b0619"],
    ["008_ai_pipeline_session_delete_upload_intent_cleanup.sql", "d8d5305aaa64974553b8a6b65a0e0564a9c6b027d24d63813aef379d30906dff"],
    ["009_ai_pipeline_contract_hardening.sql", "52b3bb57ad2eefdb1a22f928489049b9657bb1bff30fa37c55cc3d6ece7c60ff"],
    ["010_ai_pipeline_optional_note.sql", "b57909e6ff63d3d564de35881a5c21cd46687bb5c1b3d1f5c0eabd98678dc89b"],
  ]);

  for (const [fileName, expectedHash] of historicalMigrations) {
    const file = migrationPath(fileName);
    assert.equal(existsSync(file), true, `missing deployed migration ${fileName}`);
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), expectedHash);
  }

  assert.equal(existsSync(migrationPath("011_acting_api_pipeline.sql")), true);
  assert.equal(existsSync(migrationPath("012_canonical_consent_contract.sql")), true);
  assert.equal(existsSync(migrationPath("013_scene_context_only.sql")), true);
  assert.equal(existsSync(migrationPath("004_acting_api_pipeline.sql")), false);

  const prefixes = readdirSync(migrationPath())
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) => {
      const match = fileName.match(/^(\d+)_/);
      assert.ok(match, `migration must start with a numeric version: ${fileName}`);
      return match[1];
    });
  assert.equal(new Set(prefixes).size, prefixes.length, "migration versions must be unique");
});

test("acting-api transition preserves historical and active pipeline rows", () => {
  const sql = readFileSync(migrationPath("011_acting_api_pipeline.sql"), "utf8");

  const dropVersionConstraint = sql.indexOf(
    "drop constraint if exists practice_sessions_pipeline_version_check",
  );
  const legacyBackfill = sql.indexOf(
    "update public.practice_sessions set pipeline_version = 'legacy-gemini-v1'",
  );
  assert.ok(dropVersionConstraint >= 0);
  assert.ok(dropVersionConstraint < legacyBackfill);
  assert.match(
    sql,
    /pipeline_version in \('legacy-gemini-v1','ai-pipeline\.v1','acting-api-v1'\)/,
  );

  assert.match(sql, /drop constraint if exists pipeline_consent_snapshots/);
  assert.match(
    sql,
    /pipeline_version <> 'ai-pipeline\.v1'[\s\S]*required_consent_version_snapshot is not null/,
  );
  assert.match(sql, /create or replace function public\.acttub_finalize_upload_intent/);
  assert.doesNotMatch(sql, /practice_takes_duration_ms_check/);
  assert.match(sql, /if p_duration_ms not between 1 and 180000/);
});
