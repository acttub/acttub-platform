const reportableActorKinds = new Set(["answer", "unknown"]);

const defaultFail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

export const countReportableActorTurns = (transcript) =>
  transcript.filter((item) => item.role === "actor" && reportableActorKinds.has(item.kind)).length;

/** @param {{reason:string|null,substantiveAnswerCount:number,reportableActorCount:number,lastTwoReportableKinds?:string[],fail?:(code:string)=>void}} input */
export const validateInterviewCompletionCount = ({
  reason,
  substantiveAnswerCount,
  reportableActorCount,
  lastTwoReportableKinds = [],
  fail = defaultFail,
}) => {
  const lastTwoUnknown =
    lastTwoReportableKinds.length === 2 &&
    lastTwoReportableKinds.every((kind) => kind === "unknown");
  if (
    (reason === "interview_complete_report_ready" &&
      substantiveAnswerCount < 5 &&
      !lastTwoUnknown) ||
    (reason === "hard_limit_report_ready" && reportableActorCount !== 10) ||
    (reason === "insufficient_interview_evidence" &&
      reportableActorCount !== 10 &&
      substantiveAnswerCount < 5 &&
      !lastTwoUnknown)
  ) {
    fail("invalid_completion_count");
  }
};

export { validateReportSectionLineage } from "./report-lineage.js";
