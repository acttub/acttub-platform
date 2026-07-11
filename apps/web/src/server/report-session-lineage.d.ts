import type { ImmutableAiReport, PipelineSessionAggregate } from "./repositories/ai-pipeline-types";

type ReportSessionContext = Pick<PipelineSessionAggregate,
  "sessionId" | "completionReason" | "reportEvidenceObservationIds" | "reportEvidenceAnswerTurnIds" |
  "observations" | "corrections" | "transcript" | "runs" | "summary"
>;

export function validateReportSessionLineage(input: {
  report: ImmutableAiReport;
  session: ReportSessionContext;
  fail?: (code: string) => void;
}): ImmutableAiReport;
