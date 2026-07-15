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

test("completed report exposes the session review survey as a safe external link", () => {
  const reportComponent = source.match(
    /function Report\([\s\S]*?\n}\n\nfunction ReportSection/,
  )?.[0];

  assert.ok(reportComponent, "Report component must be defined");
  assert.match(reportComponent, /href="https:\/\/acttub\.github\.io\/review-form\/"/);
  assert.match(reportComponent, /target="_blank"/);
  assert.match(reportComponent, /rel="noopener noreferrer"/);
  assert.ok(
    reportComponent.indexOf("if (!report)") <
      reportComponent.indexOf('href="https://acttub.github.io/review-form/"'),
    "the survey link must render only after a report is available",
  );
});

test("persisted recovery refreshes expired and ambiguous operations", () => {
  assert.match(source, /acting_session_expired/);
  assert.match(source, /upstream_outcome_unknown/);
  assert.match(source, /report_outcome_unknown/);
  assert.match(source, /await getPracticeSession\(sessionId\)/);
  assert.match(source, /setRestartRequired\(persisted\.currentRun\?\.recoveryAction === "restart"\)/);
});
