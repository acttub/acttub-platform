const reportableActorKinds = new Set(["answer", "unknown"]);

const defaultFail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

export const countReportableActorTurns = (transcript) =>
  transcript.filter((item) => item.role === "actor" && reportableActorKinds.has(item.kind)).length;

export const validateInterviewCompletionCount = ({
  reason,
  substantiveAnswerCount,
  reportableActorCount,
  fail = defaultFail,
}) => {
  if (
    (reason === "interview_complete_report_ready" && substantiveAnswerCount < 5) ||
    (reason === "hard_limit_report_ready" && reportableActorCount !== 10) ||
    (reason === "insufficient_interview_evidence" && reportableActorCount !== 10)
  ) {
    fail("invalid_completion_count");
  }
};

const matchTimestamp = (range, segments) =>
  segments.some((segment) => segment.startMs === range.startMs && segment.endMs === range.endMs);

const validateTimestampRange = ({ key, section, observationIds, turnIds, observationSegments, correctionSegments, fail }) => {
  if (section.timestampRange === null) {
    if (key === "primaryReviewPoint") fail("invalid_report_timestamp");
    return;
  }
  const range = section.timestampRange;
  if (typeof range.startMs !== "number" || typeof range.endMs !== "number" || range.endMs < range.startMs) fail("invalid_report_timestamp");
  if (key === "primaryReviewPoint") {
    if (!matchTimestamp(range, observationIds.map((id) => observationSegments.get(id)).filter(Boolean))) fail("invalid_report_timestamp");
    return;
  }
  const sourceSegments = [
    ...observationIds.map((id) => observationSegments.get(id)).filter(Boolean),
    ...turnIds.map((id) => correctionSegments.get(id)).filter(Boolean),
  ];
  if (!matchTimestamp(range, sourceSegments)) fail("invalid_report_timestamp");
};

export const validateReportSectionLineage = ({
  key,
  section,
  selectedObservationIds,
  selectedAnswerIds,
  selectedAnswerTurnIds,
  correctionTurnIds,
  observationSegments,
  correctionSegments,
  fail = defaultFail,
}) => {
  const selectedObs = selectedObservationIds instanceof Set ? selectedObservationIds : new Set(selectedObservationIds);
  const selectedAnswers = selectedAnswerIds instanceof Set ? selectedAnswerIds : new Set(selectedAnswerIds);
  const selectedAnswerTurns = selectedAnswerTurnIds instanceof Set ? selectedAnswerTurnIds : new Set(selectedAnswerTurnIds);
  const corrections = correctionTurnIds instanceof Set ? correctionTurnIds : new Set(correctionTurnIds);
  if ([...selectedAnswers].some((id) => !selectedAnswerTurns.has(id))) fail("invalid_report_evidence");
  const obsIds = section.observationEvidenceIds ?? [];
  const turnIds = section.turnEvidenceIds ?? [];

  if (section.status === "not_confirmed") {
    if (section.content !== null || obsIds.length || turnIds.length || section.timestampRange !== null) fail("invalid_unconfirmed_section");
    return;
  }

  if (typeof section.content !== "string" || !section.content.trim()) fail("invalid_confirmed_section");

  const turnSources =
    key === "oneLineSummary" || key === "confirmedEvidence"
      ? turnIds.every((id) => selectedAnswers.has(id))
      : key === "actorDiscovery"
        ? turnIds.every((id) => selectedAnswers.has(id) || corrections.has(id))
        : key === "groundedEncouragement" || key === "nextPracticeStep"
          ? turnIds.every((id) => corrections.has(id))
          : turnIds.length === 0;

  if (obsIds.some((id) => !selectedObs.has(id)) || !turnSources) fail("invalid_report_evidence");

  if (key === "oneLineSummary" || key === "confirmedEvidence") {
    if (obsIds.length === 0 || turnIds.length === 0) fail("invalid_report_evidence");
  } else if (key === "primaryReviewPoint") {
    if (obsIds.length === 0 || turnIds.length !== 0) fail("invalid_report_evidence");
  } else if (key === "actorDiscovery") {
    if (turnIds.length === 0) fail("invalid_report_evidence");
  } else if (key === "groundedEncouragement") {
    if (obsIds.length === 0) fail("invalid_report_evidence");
  } else if (key === "nextPracticeStep") {
    if (obsIds.length + turnIds.length === 0) fail("invalid_report_evidence");
  }

  if (key === "primaryReviewPoint" && section.timestampRange === null) fail("timestampRequired");
  validateTimestampRange({ key, section, observationIds: obsIds, turnIds, observationSegments, correctionSegments, fail });

};
