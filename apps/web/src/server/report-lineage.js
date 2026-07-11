const defaultFail=(code)=>{const error=new Error(code);error.code=code;throw error};
const matchTimestamp = (range, segments) =>
  segments.some((segment) => segment.startMs === range.startMs && segment.endMs === range.endMs);

const validateTimestampRange = ({ key, section, observationIds, turnIds, observationSegments, correctionSegments, fail }) => {
  if (section.timestampRange === null) {
    if (key === "primaryReviewPoint") fail("invalid_report_timestamp");
    return;
  }
  const range = section.timestampRange;
  if (typeof range.startMs !== "number" || typeof range.endMs !== "number" || range.endMs < range.startMs) fail("invalid_report_timestamp");
  const sourceSegments = observationIds.map((id) => observationSegments.get(id)).filter(Boolean);
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
  const allowedTurnIds = new Set(selectedAnswerTurns);
  const hasSelectedAnswer = turnIds.some((id) => selectedAnswerTurns.has(id));
  const allTurnRefsAllowed = turnIds.every((id) => allowedTurnIds.has(id));
  const hasSelectedAnswerOutsideEvidence = turnIds.some((id) => selectedAnswerTurns.has(id) && !selectedAnswers.has(id));

  if (section.status === "not_confirmed") {
    if (section.content !== null || obsIds.length || turnIds.length || section.timestampRange !== null) fail("invalid_unconfirmed_section");
    return;
  }

  if (typeof section.content !== "string" || !section.content.trim()) fail("invalid_confirmed_section");
  if (obsIds.some((id) => !selectedObs.has(id)) || !allTurnRefsAllowed || hasSelectedAnswerOutsideEvidence) fail("invalid_report_evidence");

  if (key === "oneLineSummary" || key === "confirmedEvidence") {
    if (obsIds.length === 0 || !hasSelectedAnswer) fail("invalid_report_evidence");
  } else if (key === "primaryReviewPoint") {
    if (obsIds.length === 0) fail("invalid_report_evidence");
  } else if (key === "actorDiscovery") {
    if (turnIds.length === 0) fail("invalid_report_evidence");
  } else if (key === "groundedEncouragement") {
    if (obsIds.length === 0) fail("invalid_report_evidence");
  } else if (key === "nextPracticeStep") {
    if (obsIds.length + turnIds.length === 0) fail("invalid_report_evidence");
  }

  if (key === "primaryReviewPoint" && section.timestampRange === null) fail("timestampRequired");
  validateTimestampRange({
    key,
    section,
    observationIds: obsIds,
    turnIds,
    observationSegments,
    correctionSegments,
    fail,
  });

};
