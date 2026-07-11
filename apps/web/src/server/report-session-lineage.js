import { validateReportSectionLineage } from "./report-lineage.js";

const defaultFail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

export const validateReportSessionLineage = ({ report, session, fail = defaultFail }) => {
  if (report.sessionId !== session.sessionId || report.completionReason !== session.completionReason) fail("report.session");
  const summaryRunId = session.summary?.sourceRunId;
  const summaryRun = session.runs.find((run) =>
    run.id === summaryRunId && run.stage === "summary" && run.status === "completed" && run.responseSchemaVersion === "summary-response.v1"
  );
  if (!summaryRun) fail("report.summaryRun");
  const reportRun = session.runs.find((run) =>
    run.id === report.sourceRunId && run.stage === "report" && run.status === "completed" &&
    run.responseSchemaVersion === "report.v1" && Boolean(run.model?.trim()) && run.promptVersion === "acting-report.prompt.v2"
  );
  if (!reportRun) fail("report.sourceRun");
  const reportPayload = reportRun.responsePayload;
  if (!reportPayload || reportPayload.runId !== report.sourceRunId || reportPayload.sessionId !== session.sessionId) fail("report.sourceRun");

  const currentSelectedObservationIds = new Set(session.observations.filter((item) =>
    item.confirmationState === "accepted" && !item.blockedForQuestioning && item.sourceRunId === summaryRun.id
  ).map((item) => item.id));
  const currentSelectedAnswerTurnIds = new Set(session.transcript.filter((turn) =>
    turn.role === "actor" && turn.kind === "answer" && turn.reportEvidenceSelected
  ).map((turn) => turn.id));
  const currentCorrectionTurnIds = new Set(session.transcript.filter((turn) =>
    turn.role === "actor" && turn.kind === "actor_correction"
  ).map((turn) => turn.id));
  const selectedObservationIds = new Set(session.reportEvidenceObservationIds);
  const selectedAnswerIds = new Set(session.reportEvidenceAnswerTurnIds);
  const correctionTurnIds = new Set(session.corrections.map((item) => item.correctionByTurnId));
  const observationSegments = new Map(session.observations.map((item) => [item.id, { startMs: item.startMs, endMs: item.endMs }]));
  const correctionSegments = new Map(session.corrections.map((item) => [item.correctionByTurnId, item.segment]));
  const transcriptTurns = new Map(session.transcript.map((item) => [item.id, item]));
  if (session.reportEvidenceObservationIds.some((id) => !currentSelectedObservationIds.has(id))) fail("report.selectedEvidence");
  if (session.reportEvidenceAnswerTurnIds.some((id) => !currentSelectedAnswerTurnIds.has(id))) fail("report.selectedEvidence");
  if (session.corrections.some((item) => !currentCorrectionTurnIds.has(item.correctionByTurnId))) fail("report.selectedEvidence");
  for (const correction of session.corrections) {
    const turn = transcriptTurns.get(correction.correctionByTurnId);
    const source = session.observations.find((item) => item.id === correction.correctsObservationId);
    if (!turn || turn.role !== "actor" || turn.kind !== "actor_correction" || turn.content !== correction.text ||
        !source || source.confirmationState !== "rejected" || !source.blockedForQuestioning || source.sourceRunId !== summaryRun.id) {
      fail("report.correctionTranscript");
    }
  }
  if (!session.completionReason?.endsWith("_report_ready")) fail("report.completionReason");
  for (const [key, section] of Object.entries({
    oneLineSummary: report.oneLineSummary,
    primaryReviewPoint: report.primaryReviewPoint,
    confirmedEvidence: report.confirmedEvidence,
    actorDiscovery: report.actorDiscovery,
    groundedEncouragement: report.groundedEncouragement,
    nextPracticeStep: report.nextPracticeStep,
  })) {
    validateReportSectionLineage({
      key, section, selectedObservationIds, selectedAnswerIds,
      selectedAnswerTurnIds: currentSelectedAnswerTurnIds, correctionTurnIds,
      observationSegments, correctionSegments, fail,
    });
  }
  return report;
};
