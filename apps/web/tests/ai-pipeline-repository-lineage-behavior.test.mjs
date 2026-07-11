import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { isLowerHex64 } from "../src/server/ai-pipeline-fingerprint.js";
import { validateReportSectionLineage } from "../src/server/ai-pipeline-runtime-rules.js";

const loadHooks = async () => {
  const sourcePath = path.resolve(import.meta.dirname, "../src/server/repositories/supabase-ai-pipeline-repository.ts");
  const outputPath = path.resolve(import.meta.dirname, ".ai-pipeline-repository.lineage.generated.mjs");
  const source = (await readFile(sourcePath, "utf8")).replace(/^import[^;]+;\s*$/gm, "");
  const preamble = `
const createSupabaseAdminClient = () => null;
const applyOwnerSessionScope = (query) => query;
const { isLowerHex64, validateReportSectionLineage } = globalThis.__task105RepositoryImports;
const CONFIRMATION_VALUES = ["unasked", "accepted", "rejected", "unsure"];
`;
  globalThis.__task105RepositoryImports = { isLowerHex64, validateReportSectionLineage };
  const compiled = ts.transpileModule(preamble + source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  await writeFile(outputPath, compiled);
  try { return (await import(`${path.toNamespacedPath(outputPath)}?v=${Date.now()}`)).aiPipelineRepositoryTestHooks; }
  finally { await rm(outputPath, { force: true }); delete globalThis.__task105RepositoryImports; }
};

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const section = (observationEvidenceIds, turnEvidenceIds, timestampRange = null) => ({ status: "confirmed", content: "grounded", observationEvidenceIds, turnEvidenceIds, timestampRange });

const fixture = () => {
  const sessionId = id("1"), summaryRunId = id("2"), reportRunId = id("3"), observationId = id("4"), answerId = id("5"), rejectedObservationId = id("6"), correctionTurnId = id("7"), correctionId = id("8");
  const sections = {
    oneLineSummary: section([observationId], [answerId]),
    primaryReviewPoint: section([observationId], [], { startMs: 10, endMs: 20 }),
    confirmedEvidence: section([observationId], [answerId]),
    actorDiscovery: section([], [answerId]),
    groundedEncouragement: section([observationId], []),
    nextPracticeStep: section([], [answerId]),
  };
  const row = { session_id: sessionId, source_run_id: reportRunId, schema_version: "report.v1", completion_reason: "hard_limit_report_ready", one_line_summary: sections.oneLineSummary, primary_review_point: sections.primaryReviewPoint, confirmed_evidence: sections.confirmedEvidence, actor_discovery: sections.actorDiscovery, grounded_encouragement: sections.groundedEncouragement, next_practice_step: sections.nextPracticeStep, created_at: "2026-01-01T00:00:00Z" };
  const session = {
    sessionId, completionReason: "hard_limit_report_ready", reportEvidenceObservationIds: [observationId], reportEvidenceAnswerTurnIds: [answerId],
    summary: { sourceRunId: summaryRunId },
    observations: [{ id: observationId, sourceRunId: summaryRunId, confirmationState: "accepted", blockedForQuestioning: false, startMs: 10, endMs: 20 }, { id: rejectedObservationId, sourceRunId: summaryRunId, confirmationState: "rejected", blockedForQuestioning: true, startMs: 30, endMs: 40 }],
    corrections: [{ id: correctionId, correctsObservationId: rejectedObservationId, correctionByTurnId: correctionTurnId, text: "actor correction", segment: { startMs: 30, endMs: 40 } }],
    transcript: [{ id: answerId, role: "actor", kind: "answer", reportEvidenceSelected: true, content: "answer" }, { id: correctionTurnId, role: "actor", kind: "actor_correction", reportEvidenceSelected: false, content: "actor correction" }],
    runs: [
      { id: summaryRunId, stage: "summary", status: "completed", responseSchemaVersion: "summary-response.v1" },
      { id: reportRunId, stage: "report", status: "completed", responseSchemaVersion: "report.v1", model: "report-model", promptVersion: "acting-report.prompt.v2", responsePayload: { schemaVersion: "report.v1", sessionId, runId: reportRunId, model: "report-model", promptVersion: "acting-report.prompt.v2", sections } },
    ],
  };
  return { row, session, summaryRunId, reportRunId };
};

test("repository report mapper accepts exact lineage and rejects Report run or Summary-source drift", async () => {
  const { reportForSession } = await loadHooks();
  const valid = fixture();
  assert.equal(reportForSession(valid.row, "test", valid.session).sourceRunId, valid.reportRunId);
  for (const mutate of [
    (value) => { value.session.runs[1].model = ""; },
    (value) => { value.session.runs[1].promptVersion = "wrong"; },
    (value) => { value.session.runs[1].status = "running"; },
    (value) => { value.session.observations[0].sourceRunId = id("99"); },
    (value) => { value.row.source_run_id = id("98"); },
    (value) => { value.session.corrections[0].text = "different"; },
    (value) => { value.session.observations[1].blockedForQuestioning = false; },
    (value) => { value.session.observations[1].sourceRunId = id("97"); },
    (value) => { const unselected = id("96"); value.session.transcript.push({ id: unselected, role: "actor", kind: "answer", reportEvidenceSelected: false, content: "unselected" }); value.row.actor_discovery.turnEvidenceIds = [unselected]; },
    (value) => { value.row.next_practice_step.turnEvidenceIds = [value.session.corrections[0].correctionByTurnId]; },
  ]) {
    const invalid = fixture(); mutate(invalid);
    assert.throws(() => reportForSession(invalid.row, "test", invalid.session), /Invalid AI pipeline persistence result/);
  }
});
