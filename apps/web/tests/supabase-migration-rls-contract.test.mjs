import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const readRepo = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const migration = () => readRepo("supabase/migrations/001_acttub_slice1_schema.sql");
const docs = () => readRepo("docs/supabase/slice1-schema-rls-storage.sql");

test("executable migration and docs agree on practice-videos bucket contract", () => {
  for (const source of [migration(), docs()]) {
    assert.match(source, /'practice-videos',\s*'practice-videos',\s*false,\s*314572800/);
    assert.match(source, /array\['video\/mp4', 'video\/quicktime'\]/);
    assert.doesNotMatch(source, /coach-takes/);
    assert.doesNotMatch(source, /video\/webm/);
  }
});

test("browser storage policy is insert-only through active upload intent", () => {
  const source = migration();
  assert.match(source, /create policy "practice videos insert via active upload intent"/);
  assert.match(source, /ui\.status = 'created'/);
  assert.match(source, /ui\.expires_at > now\(\)/);
  assert.match(source, /public\.is_active_acttub_profile\(auth\.uid\(\)\)/);
  assert.doesNotMatch(source, /practice videos .* for select/i);
  assert.doesNotMatch(source, /practice videos .* for update/i);
  assert.doesNotMatch(source, /practice videos .* for delete/i);
});

test("RLS tables and observation blocking constraints are present", () => {
  const source = migration();
  for (const table of ["profiles", "upload_intents", "practice_sessions", "practice_takes", "observations", "question_turns", "session_results", "validation_events"]) {
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(source, /rejected_observations_are_blocked/);
  assert.match(source, /confirmation_state <> 'rejected' or blocked_for_questioning = true/);
});
