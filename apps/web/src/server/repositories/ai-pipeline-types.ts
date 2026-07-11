export type AiStage = "summary" | "agent" | "report" | "delete";
export type AiRunStatus = "pending" | "running" | "completed" | "failed";
export type InterviewStatus = "active" | "paused" | "completed" | "completed_without_report";
export type CompletionReason =
  | "interview_complete_report_ready"
  | "manual_stop_report_ready"
  | "manual_stop_paused"
  | "hard_limit_report_ready"
  | "insufficient_confirmed_evidence"
  | "insufficient_interview_evidence";
export type ObservationConfirmation = AgentObservation["confirmationState"];
export type TranscriptRole = "agent" | "actor";
export type TranscriptKind = "question" | "closing" | "answer" | "unknown" | "observation_confirmation" | "actor_correction" | "optional_note";

export interface AiRun {
  id: string; sessionId: string; userId: string; stage: AiStage; status: AiRunStatus;
  idempotencyKey: string; attempt: number; maxAttempts: number;
  requestSchemaVersion: string | null; responseSchemaVersion: string | null;
  model: string | null; promptVersion: string | null; safeErrorCode: string | null;
  retryable: boolean; startedAt: string | null; completedAt: string | null;
}
export interface PipelineObservation {
  id: string; candidateId: string | null; confirmationState: ObservationConfirmation;
  sourceRunId: string | null;
  blockedForQuestioning: boolean; priority: number | null; startMs: number; endMs: number;
  text: string; dimension: string | null; severity: "high" | "mid" | "low" | null;
}
export interface ActorCorrection {
  id: string; correctsObservationId: string; segment: Segment; text: string; correctionByTurnId: string;
}
export interface InterviewTurn {
  id: string; sequence: number; role: TranscriptRole; kind: TranscriptKind; content: string;
  questionFocus: string | null; groundingStartMs: number | null; groundingEndMs: number | null;
  sourceObservationIds: string[]; reportEvidenceSelected: boolean;
}
export interface ReportSection {
  status: "confirmed" | "not_confirmed"; content: string | null;
  observationEvidenceIds: string[]; turnEvidenceIds: string[];
  timestampRange: { startMs: number; endMs: number } | null;
}
export interface ImmutableAiReport {
  sessionId: string; sourceRunId: string; schemaVersion: "report.v1"; completionReason: CompletionReason;
  oneLineSummary: ReportSection; primaryReviewPoint: ReportSection; confirmedEvidence: ReportSection;
  actorDiscovery: ReportSection; groundedEncouragement: ReportSection; nextPracticeStep: ReportSection;
  createdAt: string;
}
export interface PipelineSessionAggregate {
  sessionId: string; userId: string; pipelineVersion: "ai-pipeline.v1";
  requiredConsentVersionSnapshot: string; aiProcessingConsentVersionSnapshot: string;
  interviewStatus: InterviewStatus | null; completionReason: CompletionReason | null;
  substantiveAnswerCount: number; reportEvidenceObservationIds: string[]; reportEvidenceAnswerTurnIds: string[];
  summary: { sourceRunId: string; normalizedSummary: NormalizedSummary } | null;
  sceneContext: { genre:string; situation:string; characterContext:string; subtext:string|null };
  take: { id:string; storageBucket:"practice-videos"; storagePath:string; durationMs:number; mediaMetadataVersion:"iso-bmff-duration.v1" };
  observations: PipelineObservation[]; corrections: ActorCorrection[]; transcript: InterviewTurn[];
  runs: AiRun[]; report: ImmutableAiReport | null;
}

export interface ClaimRunInput { sessionId:string; userId:string; stage:AiStage; runId:string; idempotencyKey:string; maxAttempts:number; requestSchemaVersion:string; model:string; promptVersion:string }
export interface FailRunInput { sessionId:string; userId:string; runId:string; safeErrorCode:string; retryable:boolean }
export interface ConfirmObservationInput { sessionId:string; userId:string; observationId:string; state:Exclude<ObservationConfirmation,"unasked">; correction:null|{id:string;turnId:string;text:string} }
export interface SummaryCompletionInput { sessionId:string; userId:string; runId:string; normalizedSummary:NormalizedSummary; candidates:Array<{id:string;startMs:number;endMs:number;text:string;priority:number;dimension:string;severity:"high"|"mid"|"low"|null}> }
export interface RecordRunModelInput { sessionId:string; userId:string; runId:string; model:string }
export interface PipelineTurnInput { sessionId:string; userId:string; agentRunId:string; expectedSubstantiveAnswerCount:number; actorTurn:InterviewTurn|null; agentTurn:InterviewTurn; currentInput:{command:"start"|"observation_update"|"answer"|"manual_stop"|"resume";answer:string|null;answerTurnId:string|null;observationId:string|null}; reportEvidence:{observationIds:string[];answerTurnIds:string[]} }
export interface CompleteInterviewInput { sessionId:string; userId:string; status:InterviewStatus; completionReason:CompletionReason; observationIds:string[]; answerTurnIds:string[] }
export interface CompleteReportInput { sessionId:string; userId:string; runId:string; report:{schemaVersion:"report.v1";sections:{oneLineSummary:ReportSection;primaryReviewPoint:ReportSection;confirmedEvidence:ReportSection;actorDiscovery:ReportSection;groundedEncouragement:ReportSection;nextPracticeStep:ReportSection}} }
export interface DeleteInput { sessionId:string; userId:string; requestId:string }
import type { AgentObservation, NormalizedSummary, Segment } from "@/server/ai/contracts";
