import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const repository = readFileSync(
  path.join(webRoot, "src/server/repositories/supabase-coach-session-repository.ts"),
  "utf8",
);

test("legacy session reads do not require acting-api relations", () => {
  const legacySelect = repository.match(
    /const legacySessionSelect = `([\s\S]*?)`;/,
  )?.[1];

  assert.ok(legacySelect, "legacySessionSelect must be defined");
  assert.match(legacySelect, /practice_takes\(\*\)/);
  assert.match(legacySelect, /session_results\(\*\)/);
  assert.doesNotMatch(
    legacySelect,
    /scene_summaries|practice_interview_runs|practice_turns|practice_reports/,
  );
});

test("acting-api relations are queried only after acting rows are found", () => {
  const actingSelect = repository.match(
    /const actingSessionSelect = `([\s\S]*?)`;/,
  )?.[1];
  const listOwnedSessions = repository.match(
    /async listOwnedSessions\(userId: string\): Promise<CoachSessionDto\[]> \{([\s\S]*?)\n  \},/,
  )?.[1];

  assert.ok(actingSelect, "actingSessionSelect must be defined");
  assert.match(actingSelect, /scene_summaries\(\*\)/);
  assert.match(
    actingSelect,
    /practice_interview_runs:practice_interview_runs!practice_interview_runs_session_id_user_id_fkey\(\*\)/,
    "acting session reads must disambiguate the session-to-runs relationship",
  );
  assert.ok(listOwnedSessions, "listOwnedSessions must be defined");
  assert.match(listOwnedSessions, /\.select\(legacySessionSelect\)/);
  assert.match(listOwnedSessions, /if \(actingRows\.length === 0\)/);
  assert.match(listOwnedSessions, /\.select\(actingSessionSelect\)/);
  assert.ok(
    listOwnedSessions.indexOf("if (actingRows.length === 0)") <
      listOwnedSessions.indexOf(".select(actingSessionSelect)"),
    "acting relations must not be selected before the legacy-only fast path returns",
  );
});
