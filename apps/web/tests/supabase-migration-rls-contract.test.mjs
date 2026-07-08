import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function migration() {
  return readRepo("supabase/migrations/001_acttub_slice1_schema.sql");
}

function docs() {
  return readRepo("docs/supabase/slice1-schema-rls-storage.sql");
}

const lifecycleTables = [
  "upload_intents",
  "practice_sessions",
  "practice_takes",
  "observations",
  "question_turns",
  "session_results",
  "validation_events",
];

function policyBlocks(source) {
  return source.match(/create policy\s+"[^"]+"[\s\S]*?;/gi) ?? [];
}

function normalizeSql(source) {
  return source.replace(/\s+/g, " ").trim();
}

test("executable migration and docs agree on practice-videos bucket contract", () => {
  for (const source of [migration(), docs()]) {
    assert.match(source, /'practice-videos',\s*'practice-videos',\s*false,\s*314572800/);
    assert.match(source, /array\['video\/mp4', 'video\/quicktime'\]/);
    assert.doesNotMatch(source, /\bacttub\./);
    assert.doesNotMatch(source, /coach-takes/);
    assert.doesNotMatch(source, /video\/webm/);
  }
});

test("browser storage policy is insert-only through active upload intent", () => {
  for (const source of [migration(), docs()]) {
    assert.match(source, /create policy "practice videos insert via active upload intent"/);
    assert.match(source, /owner = auth\.uid\(\)/);
    assert.match(source, /ui\.status = 'created'/);
    assert.match(source, /ui\.expires_at > now\(\)/);
    assert.match(source, /public\.is_active_acttub_profile\(auth\.uid\(\)\)/);
    assert.doesNotMatch(source, /practice videos .* for select/i);
    assert.doesNotMatch(source, /practice videos .* for update/i);
    assert.doesNotMatch(source, /practice videos .* for delete/i);
  }
});

test("RLS tables and observation blocking constraints are present", () => {
  const source = migration();
  for (const table of ["profiles", "upload_intents", "practice_sessions", "practice_takes", "observations", "question_turns", "session_results", "validation_events"]) {
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(source, /rejected_observations_are_blocked/);
  assert.match(source, /confirmation_state <> 'rejected' or blocked_for_questioning = true/);
});

test("executable migration and docs are byte-identical", () => {
  assert.equal(docs(), migration());
});

test("browser-authenticated lifecycle RLS is read-only and server-write bounded", () => {
  for (const source of [migration(), docs()]) {
    const policies = policyBlocks(source);

    for (const table of lifecycleTables) {
      const tablePolicies = policies.filter((block) =>
        new RegExp(`\\bon\\s+public\\.${table}\\b`, "i").test(block),
      );

      assert.ok(tablePolicies.length > 0, `expected owner-visible SELECT policy for ${table}`);
      assert.ok(
        tablePolicies.some((block) => /\bfor\s+select\b/i.test(block)),
        `expected SELECT policy for ${table}`,
      );

      for (const block of tablePolicies) {
        assert.doesNotMatch(
          block,
          /\bfor\s+(?:all|insert|update|delete)\b/i,
          `browser-authenticated lifecycle write policy must not exist for ${table}: ${block}`,
        );
      }
    }

    assert.doesNotMatch(source, /owner crud/i);
    assert.doesNotMatch(source, /owner soft hide/i);

    const normalized = normalizeSql(source);
    assert.match(
      normalized,
      /revoke insert, update, delete on public\.upload_intents, public\.practice_sessions, public\.practice_takes, public\.observations, public\.question_turns, public\.session_results, public\.validation_events from anon, authenticated;/,
    );
    assert.match(
      normalized,
      /grant select on public\.upload_intents, public\.practice_sessions, public\.practice_takes, public\.observations, public\.question_turns, public\.session_results, public\.validation_events to authenticated;/,
    );

    for (const table of lifecycleTables) {
      assert.doesNotMatch(
        normalized,
        new RegExp(`grant (?:all(?: privileges)?|insert|update|delete)[^;]*public\\.${table}[^;]*to (?:anon|authenticated)`, "i"),
        `broad lifecycle write grant must not exist for ${table}`,
      );
    }
  }
});
