import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const immutableMigrationHashes = new Map([
  ["001_acttub_slice1_schema.sql", "b48698fae7629c7b55f4171a7f3443a429ded0f2f47f08b7b8794d2b3208b04b"],
  ["002_remove_legacy_practice_generation.sql", "609fd5c1e12d9bf1e2d5ca7d847cef9d82302aceb63eb0890852fef3926405e3"],
  ["003_atomic_dialogue_turn_append.sql", "f56e9afa06e44b2ec227f9c61527e2454dacf436d2956dc16cd8eedf71730899"],
  ["004_ai_pipeline_data_plane.sql", "fb345afce506086e4877300dd2ae7b4e4e1820a5797eb35d72e0697fa6f2ca36"],
  ["005_close_ai_table_select_privilege_gaps.sql", "e1fcbdac50bf81790de80b4e8b17dd1a1cde7df30f14704d769e35c09dc14fce"],
  ["006_pipeline_security_advisor_hardening.sql", "a9648afc32ad4876c069aaca9d1400123c9d8396532da99be7aa4c1ba7874dfc"],
  ["007_ai_pipeline_unknown_turn_count.sql", "05c05c0e89e52ffb9ab805fe176f7db8fab6a8feb5f87ff5bdf38acbb38b0619"],
  ["008_ai_pipeline_session_delete_upload_intent_cleanup.sql", "d8d5305aaa64974553b8a6b65a0e0564a9c6b027d24d63813aef379d30906dff"],
  ["009_ai_pipeline_contract_hardening.sql", "52b3bb57ad2eefdb1a22f928489049b9657bb1bff30fa37c55cc3d6ece7c60ff"],
  ["010_ai_pipeline_optional_note.sql", "b57909e6ff63d3d564de35881a5c21cd46687bb5c1b3d1f5c0eabd98678dc89b"],
  ["011_acting_api_pipeline.sql", "69d743df6fe9c3ebd1ddb56355c604e7f542ce1d204933bbdff08315153c2ee6"],
  ["012_canonical_consent_contract.sql", "d9e77e881f8b15614fe549d54a396a753205587976c9489e818a9d5f8beba20d"],
  ["013_scene_context_only.sql", "a2b8b2054d98431397c37bc9605664d2bd98ae168be52bba7421d26f40a01092"],
  ["014_lock_profile_and_terms_owners.sql", "d80d88cdeab177417650b3d2f3a71ee1129e605b3d4cfddf6a9e7b0bb496b629"],
]);

test("root exposes canonical test aliases", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts.test, "pnpm test:web");
  assert.equal(packageJson.scripts["test:web"], "pnpm --filter web test");
});

test("deployed migrations 001 through 014 remain immutable", () => {
  for (const [file, expectedHash] of immutableMigrationHashes) {
    const actualHash = createHash("sha256")
      .update(read(`supabase/migrations/${file}`))
      .digest("hex");
    assert.equal(actualHash, expectedHash, `${file} must be corrected only by an additive migration`);
  }
});

test("item 1 is implemented only through the additive 014 migration", () => {
  const migrationFiles = readdirSync(path.join(repoRoot, "supabase/migrations")).sort();
  assert.ok(migrationFiles.includes("014_lock_profile_and_terms_owners.sql"));

  const sql = read("supabase/migrations/014_lock_profile_and_terms_owners.sql");
  assert.match(sql, /drop policy if exists "profiles owner insert self" on public\.profiles/);
  assert.match(sql, /drop policy if exists "profiles owner update terms" on public\.profiles/);
  assert.match(sql, /revoke insert, update on table public\.profiles from authenticated/);
  assert.match(sql, /create or replace function public\.acttub_accept_terms/);
  assert.match(sql, /from public\.profiles[\s\S]*where id = p_user_id[\s\S]*for update/);
  assert.match(sql, /if v_status = 'suspended'[\s\S]*account_suspended[\s\S]*errcode = 'PT403'/);
  assert.match(sql, /if v_status not in \('pending_terms', 'active'\)/);
  assert.match(sql, /set[\s\S]*status = 'active'[\s\S]*required_consent_version[\s\S]*ai_processing_consent_version/);
  assert.match(sql, /revoke execute on function public\.acttub_accept_terms\([^)]+\)\s+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.acttub_accept_terms\([^)]+\)\s+to service_role/);

  assert.doesNotMatch(sql, /upload_intents|storage\.objects|request_id|duration_ms|acting_api/i);
});

test("profile creation and terms transitions are server-owned", () => {
  const source = read("apps/web/src/server/services/auth-context.ts");
  const ensurePendingProfile = source.slice(
    source.indexOf("export async function ensurePendingProfile"),
    source.indexOf("export async function recordTermsAcceptance"),
  );
  const recordTermsAcceptance = source.slice(
    source.indexOf("export async function recordTermsAcceptance"),
    source.indexOf("export async function getAuthContext"),
  );

  assert.match(ensurePendingProfile, /createSupabaseAdminClient\(\)/);
  assert.doesNotMatch(ensurePendingProfile, /getProfileClient\(\)/);
  assert.match(ensurePendingProfile, /status: "pending_terms"/);
  assert.match(recordTermsAcceptance, /\.rpc\("acttub_accept_terms"/);
  assert.doesNotMatch(recordTermsAcceptance, /\.upsert\(/);
  assert.match(recordTermsAcceptance, /account_suspended/);
  assert.match(source, /"unauthenticated" \| "terms_required" \| "account_suspended"/);
});

test("suspended terms rejection is a 403 before any success cookie can be created", () => {
  const route = read("apps/web/src/app/api/v1/terms/acceptances/route.ts");
  const authContext = read("apps/web/src/server/services/auth-context.ts");
  const rpcCall = route.indexOf("await recordTermsAcceptance");
  const responseCreation = route.indexOf("const response =");
  const cookieWrite = route.indexOf("response.cookies.set");

  assert.ok(rpcCall >= 0 && rpcCall < responseCreation && responseCreation < cookieWrite);
  assert.match(authContext, /new ApiAuthError\(403, "account_suspended"/);
});
