import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = readFileSync(
  path.resolve(import.meta.dirname, "../src/features/practice/practice-flow.tsx"),
  "utf8",
);

test("acting report renders every canonical section and optional comparison", () => {
  for (const field of ["headline", "reportCount", "evidence", "selfDiscovery", "encouragement", "nextStep"]) {
    assert.match(source, new RegExp(`report\\.${field}`));
  }
  assert.match(source, /report\.biggestProblem\.start/);
  assert.match(source, /report\.biggestProblem\.end/);
  assert.match(source, /report\.biggestProblem\.dimension/);
  assert.match(source, /report\.biggestProblem\.description/);
  assert.match(source, /report\.comparison\?\.trim\(\)/);
});

test("persisted recovery refreshes expired and ambiguous operations", () => {
  assert.match(source, /acting_session_expired/);
  assert.match(source, /upstream_outcome_unknown/);
  assert.match(source, /report_outcome_unknown/);
  assert.match(source, /await getPracticeSession\(sessionId\)/);
  assert.match(source, /setRestartRequired\(persisted\.currentRun\?\.recoveryAction === "restart"\)/);
});
