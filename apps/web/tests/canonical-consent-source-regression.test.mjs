import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("upload intent creation delegates the consent snapshot to the database default", () => {
  const repository = read("apps/web/src/server/repositories/supabase-coach-session-repository.ts");
  const createUploadIntent = repository.slice(
    repository.indexOf("async createUploadIntent"),
    repository.indexOf("async findUploadIntent"),
  );

  assert.doesNotMatch(createUploadIntent, /consent_version\s*:/);
  assert.doesNotMatch(createUploadIntent, /termsVersion/);
});

test("migration 015 makes current consent database-canonical at every authorization boundary", () => {
  const migrationFiles = readdirSync(path.join(repoRoot, "supabase/migrations")).sort();
  assert.equal(migrationFiles.includes("015_canonicalize_consent_versions.sql"), true);

  const sql = read("supabase/migrations/015_canonicalize_consent_versions.sql");
  assert.match(
    sql,
    /alter table public\.upload_intents[\s\S]*alter column consent_version set default public\.current_acttub_terms_version\(\)/,
  );
  assert.match(sql, /create or replace function public\.is_active_acttub_profile/);
  assert.match(sql, /p\.required_consent_version = public\.current_acttub_terms_version\(\)/);
  assert.match(sql, /create or replace function public\.acttub_accept_terms/);
  assert.match(sql, /v_required_consent_version text := public\.current_acttub_terms_version\(\)/);
  assert.match(sql, /p_required_consent_version is distinct from v_required_consent_version/);
  assert.match(sql, /required_consent_version = v_required_consent_version/);
  assert.match(sql, /consent_version = v_required_consent_version/);
  assert.match(sql, /create policy "practice videos insert via active upload intent"/);
  assert.match(sql, /ui\.consent_version = public\.current_acttub_terms_version\(\)/);
  assert.doesNotMatch(sql, /2026-\d{2}|ai-processing\.v\d/);
});
