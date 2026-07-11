import assert from "node:assert/strict";
import test from "node:test";

import { validateReportSessionLineage } from "../src/server/report-session-lineage.js";

const ids = {
  session: "00000000-0000-4000-8000-000000000001",
  summary: "00000000-0000-4000-8000-000000000002",
  report: "00000000-0000-4000-8000-000000000003",
  accepted: "00000000-0000-4000-8000-000000000004",
  rejected: "00000000-0000-4000-8000-000000000005",
  answer: "00000000-0000-4000-8000-000000000006",
  correction: "00000000-0000-4000-8000-000000000007",
};

const section = (key) => ({
  status: "confirmed",
  content: key,
  observationEvidenceIds: key === "actorDiscovery" ? [] : [ids.accepted],
  turnEvidenceIds: key === "primaryReviewPoint" || key === "groundedEncouragement" ? [] : [ids.answer],
  timestampRange: key === "actorDiscovery" ? null : { startMs: 100, endMs: 200 },
});

const fixture = () => {
  const report = {
    sessionId: ids.session,
    sourceRunId: ids.report,
    schemaVersion: "report.v1",
    completionReason: "hard_limit_report_ready",
    oneLineSummary: section("oneLineSummary"),
    primaryReviewPoint: section("primaryReviewPoint"),
    confirmedEvidence: section("confirmedEvidence"),
    actorDiscovery: section("actorDiscovery"),
    groundedEncouragement: section("groundedEncouragement"),
    nextPracticeStep: section("nextPracticeStep"),
    createdAt: "2026-01-01T00:00:00Z",
  };
  const session = {
    sessionId: ids.session,
    completionReason: "hard_limit_report_ready",
    reportEvidenceObservationIds: [ids.accepted],
    reportEvidenceAnswerTurnIds: [ids.answer],
    summary: { sourceRunId: ids.summary, normalizedSummary: {} },
    runs: [
      { id: ids.summary, stage: "summary", status: "completed", responseSchemaVersion: "summary-response.v1" },
      { id: ids.report, stage: "report", status: "completed", responseSchemaVersion: "report.v1", model: "model", promptVersion: "acting-report.prompt.v2", responsePayload: { runId: ids.report, sessionId: ids.session } },
    ],
    observations: [
      { id: ids.accepted, confirmationState: "accepted", blockedForQuestioning: false, sourceRunId: ids.summary, startMs: 100, endMs: 200 },
      { id: ids.rejected, confirmationState: "rejected", blockedForQuestioning: true, sourceRunId: ids.summary, startMs: 300, endMs: 400 },
    ],
    transcript: [
      { id: ids.answer, role: "actor", kind: "answer", content: "answer", reportEvidenceSelected: true },
      { id: ids.correction, role: "actor", kind: "actor_correction", content: "corrected", reportEvidenceSelected: false },
    ],
    corrections: [{ correctionByTurnId: ids.correction, correctsObservationId: ids.rejected, text: "corrected", segment: { startMs: 300, endMs: 400 } }],
  };
  return { report, session };
};

const rejects = (mutate, code) => {
  const value = fixture();
  mutate(value);
  assert.throws(() => validateReportSessionLineage(value), (error) => error.code === code);
};

test("accepts exact current report/session lineage", () => {
  const value = fixture();
  assert.equal(validateReportSessionLineage(value), value.report);
});

test("rejects stale or invalid Summary lineage", () => {
  rejects(({ session }) => { session.runs[0].status = "running"; }, "report.summaryRun");
  rejects(({ session }) => { session.observations[0].sourceRunId = ids.report; }, "report.selectedEvidence");
});

test("rejects invalid Report run identity, contract, and persisted correlation", () => {
  rejects(({ session }) => { session.runs[1].status = "running"; }, "report.sourceRun");
  rejects(({ session }) => { session.runs[1].responseSchemaVersion = "report-response.v0"; }, "report.sourceRun");
  rejects(({ session }) => { session.runs[1].model = " "; }, "report.sourceRun");
  rejects(({ session }) => { session.runs[1].promptVersion = "wrong"; }, "report.sourceRun");
  rejects(({ session }) => { session.runs[1].responsePayload.runId = ids.summary; }, "report.sourceRun");
});

test("rejects report/session completion mismatch", () => {
  rejects(({ session }) => { session.completionReason = "manual_stop_report_ready"; }, "report.session");
  rejects(({ report, session }) => { report.completionReason = session.completionReason = "manual_stop_paused"; }, "report.completionReason");
});

test("rejects correction transcript, source state, and Summary provenance mismatches", () => {
  rejects(({ session }) => { session.transcript[1].content = "different"; }, "report.correctionTranscript");
  rejects(({ session }) => { session.observations[1].confirmationState = "accepted"; }, "report.correctionTranscript");
  rejects(({ session }) => { session.observations[1].blockedForQuestioning = false; }, "report.correctionTranscript");
  rejects(({ session }) => { session.observations[1].sourceRunId = ids.report; }, "report.correctionTranscript");
});

test("rejects section evidence outside the selected current lineage", () => {
  rejects(({ report }) => { report.oneLineSummary.observationEvidenceIds = [ids.rejected]; }, "invalid_report_evidence");
  rejects(({ session }) => { session.transcript[0].reportEvidenceSelected = false; }, "report.selectedEvidence");
});
