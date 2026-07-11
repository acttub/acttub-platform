import type { DialogueCompletionReason } from "@/lib/practice/dialogue-completion-policy";

export type SessionStatus =
  | "ANALYZING"
  | "OBSERVE_CONFIRM"
  | "PROBE_LOOP"
  | "INSIGHT"
  | "END";

export type AnalysisStatus = "pending" | "completed" | "failed";

export type ConfirmationState = "unasked" | "accepted" | "rejected" | "unsure";

export type TurnSpeaker = "actor" | "coach";

export type TurnState = "recorded" | "generated" | "blocked";

export type Medium = "youtube_url" | "upload_url" | "text_only";

export type ObservationDto = {
  id: string;
  takeId: string;
  timestampStartMs: number;
  timestampEndMs: number;
  observationText: string;
  confidence: number;
  confirmationState: ConfirmationState;
  blockedForQuestioning: boolean;
  createdAt: string;
};

export type TurnDto = {
  id: string;
  sessionId: string;
  speaker: TurnSpeaker;
  content: string;
  questionFocus: "observation_confirmation" | "missing_context" | "subtext_probe" | "summary_reflection";
  sourceObservationIds: string[];
  turnState: TurnState;
  createdAt: string;
};

export type TakeDto = {
  id: string;
  sessionId: string;
  videoUrl: string | null;
  durationMs: number | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  createdAt: string;
};

export type ValidationMetricsDto = {
  feltHelpedFindGap1To7: number | null;
  feltJudged1To7: number | null;
  rejectionSafety1To7: number | null;
  answerability1To7: number | null;
  reuseIntent1To7: number | null;
  rejectedObservationReuseCount: number;
  forbiddenLanguageCount: number;
  finalSentenceResult: "empty" | "saved" | "skipped";
};

export type CoachSessionDto = {
  id: string;
  userId: string;
  status: SessionStatus;
  medium: Medium;
  genre: string;
  situation: string;
  characterContext: string;
  subtext: string;
  finalActorSentence: string | null;
  hiddenAt: string | null;
  validationMetrics: ValidationMetricsDto | null;
  createdAt: string;
  updatedAt: string;
  take: TakeDto;
  observations: ObservationDto[];
  turns: TurnDto[];
};

export type FileMetadataDto = {
  fileName: string;
  mimeType: "video/mp4" | "video/quicktime";
  sizeBytes: number;
  durationMs?: number;
};

export type PracticeUploadIntentDto = {
  uploadIntentId: string;
  sessionId: string;
  userId: string;
  storageBucket: "practice-videos";
  storagePath: string;
  uploadUrl: string;
  fileMetadata: FileMetadataDto;
  status: "created" | "finalized" | "expired";
  finalizedAt: string | null;
  constraints: {
    maxUploadBytes: number;
    allowedMimeTypes: string[];
  };
  expiresAt: string;
};

export type CreateUploadIntentRequest = {
  fileMetadata: Omit<FileMetadataDto, "durationMs">;
  adultConfirmed: true;
  allParticipantsConfirmed: true;
};

export type CreateUploadIntentResponse = {
  uploadIntent: PracticeUploadIntentDto;
};

export type FinalizeUploadIntentRequest = {
  storagePath: string;
};

export type FinalizeUploadIntentResponse = {
  uploadIntentId: string;
  storagePath: string;
  durationMs: number;
  mediaMetadataVersion: "iso-bmff-duration.v1";
};

export type CreateSessionRequest = {
  medium: Medium;
  genre: string;
  situation: string;
  characterContext: string;
  subtext?: string;
  videoUrl?: string;
  durationMs?: number;
  sessionId?: string;
  uploadIntentId?: string;
  storagePath?: string;
  fileMetadata?: FileMetadataDto;
};

export type CreatePipelineSessionRequest = {
  sessionId: string;
  uploadIntentId: string;
  storagePath: string;
  genre: string;
  situation: string;
  characterContext: string;
  subtext?: string;
};

export type CreateSessionResponse = {
  session: CoachSessionDto;
  firstQuestion: TurnDto;
};

export type PipelineAiStage = "summary" | "agent" | "report" | "delete";
export type PipelineAiRunStatus = "pending" | "running" | "completed" | "failed";
export type PipelineInterviewStatus = "active" | "paused" | "completed" | "completed_without_report";
export type PipelineCompletionReason =
  | "interview_complete_report_ready"
  | "manual_stop_report_ready"
  | "manual_stop_paused"
  | "hard_limit_report_ready"
  | "insufficient_confirmed_evidence"
  | "insufficient_interview_evidence";

export type PipelineAiRunDto = {
  id: string;
  sessionId: string;
  userId: string;
  stage: PipelineAiStage;
  status: PipelineAiRunStatus;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  requestSchemaVersion: string | null;
  responseSchemaVersion: string | null;
  model: string | null;
  promptVersion: string | null;
  safeErrorCode: string | null;
  retryable: boolean;
  startedAt: string | null;
  completedAt: string | null;
};

export type PipelineObservationDto = {
  id: string;
  candidateId: string | null;
  sourceRunId: string | null;
  confirmationState: ConfirmationState;
  blockedForQuestioning: boolean;
  priority: number | null;
  startMs: number;
  endMs: number;
  text: string;
  dimension: string | null;
  severity: "high" | "mid" | "low" | null;
};

export type PipelineObservationCandidateDto = {
  candidateId: string;
  timestampStartMs: number;
  timestampEndMs: number;
  observationText: string;
  confidence: null;
  priority: number;
  dimension: string;
  severity: "high" | "mid" | "low" | null;
};

export type PipelineActorCorrectionDto = {
  id: string;
  correctsObservationId: string;
  segment: { startMs: number; endMs: number };
  text: string;
  correctionByTurnId: string;
};

export type PipelineTranscriptTurnDto = {
  id: string;
  sequence: number;
  role: "agent" | "actor";
  kind: "question" | "closing" | "answer" | "unknown" | "observation_confirmation" | "actor_correction" | "optional_note";
  content: string;
  questionFocus: string | null;
  groundingStartMs: number | null;
  groundingEndMs: number | null;
  sourceObservationIds: string[];
  reportEvidenceSelected: boolean;
};

export type PipelineReportSectionDto = {
  status: "confirmed" | "not_confirmed";
  content: string | null;
  observationEvidenceIds: string[];
  turnEvidenceIds: string[];
  timestampRange: { startMs: number; endMs: number } | null;
};

export type PipelineNormalizedSummaryDto = {
  schemaVersion: "scene-summary.v1";
  subtextStatus: "provided" | "not_provided";
  observation: {
    timeline: string; dialogue: string; tempo: string; pitch: string;
    movement: string; expression: string; emotion: string;
    extra: Array<{ name: string; observation: string }>;
  };
  summary: string;
  intentAlignment: string | null;
  keyMoment: string | null;
  keyDimension: string | null;
  anomalies: Array<{
    start: string; end: string; dimension: string; what: string;
    whyOdd: string | null; likelyCause: string | null; impactOnIntent: string | null;
    overlapsKeyMoment: boolean | null; onKeyDimension: boolean | null;
    intentImpact: "반전" | "약화" | "국소" | null;
    severity: "high" | "mid" | "low" | null; severityReason: string | null;
  }>;
};

export type ImmutablePipelineReportDto = {
  sessionId: string;
  sourceRunId: string;
  schemaVersion: "report.v1";
  completionReason: PipelineCompletionReason;
  oneLineSummary: PipelineReportSectionDto;
  primaryReviewPoint: PipelineReportSectionDto;
  confirmedEvidence: PipelineReportSectionDto;
  actorDiscovery: PipelineReportSectionDto;
  groundedEncouragement: PipelineReportSectionDto;
  nextPracticeStep: PipelineReportSectionDto;
  createdAt: string;
};

export type PipelineSessionAggregateDto = {
  sessionId: string;
  userId: string;
  pipelineVersion: "ai-pipeline.v1";
  requiredConsentVersionSnapshot: string;
  aiProcessingConsentVersionSnapshot: string;
  interviewStatus: PipelineInterviewStatus | null;
  completionReason: PipelineCompletionReason | null;
  substantiveAnswerCount: number;
  reportEvidenceObservationIds: string[];
  reportEvidenceAnswerTurnIds: string[];
  summary: { sourceRunId: string; normalizedSummary: PipelineNormalizedSummaryDto } | null;
  sceneContext: { genre: string; situation: string; characterContext: string; subtext: string | null };
  take: { id: string; storageBucket: "practice-videos"; storagePath: string; durationMs: number; mediaMetadataVersion: "iso-bmff-duration.v1" };
  observations: PipelineObservationDto[];
  corrections: PipelineActorCorrectionDto[];
  transcript: PipelineTranscriptTurnDto[];
  runs: PipelineAiRunDto[];
  report: ImmutablePipelineReportDto | null;
};

export type CreatePipelineSessionResponse = { session: PipelineSessionAggregateDto; summaryRun: PipelineAiRunDto };
export type GetPipelineSessionResponse = { session: PipelineSessionAggregateDto };
export type ConfirmPipelineObservationRequest =
  | { state: "accepted" | "unsure"; correction?: never }
  | { state: "rejected"; correction?: string };
export type PipelineInterviewTurnRequest = { answer: string; expectedSubstantiveAnswerCount: number; expectedTotalConversationCount: number };
export type PipelineReportEvidenceDto = { observationIds: string[]; answerTurnIds: string[] };
export type PipelineInterviewResponse =
  | { done: true; completionReason: "insufficient_confirmed_evidence"; reportReady: false }
  | { actorTurn: PipelineTranscriptTurnDto | null; agentTurn: PipelineTranscriptTurnDto; done: boolean; completionReason: PipelineCompletionReason | null; reportReady: boolean; reportEvidence: PipelineReportEvidenceDto; report: ImmutablePipelineReportDto | null }
  | { run: PipelineAiRunDto; session: PipelineSessionAggregateDto };
export type DeletePipelineSessionResponse = { requestId: string; status: "deleting" | "completed" };
export type PipelineDeletionAttemptDto = { requestId: string; sessionId: string; status: "running" | "failed" | "completed"; storageDeleted: boolean; rowsDeleted: boolean; safeErrorCode: string | null; attempt: number; updatedAt: string };

export type ListSessionsResponse = {
  sessions: CoachSessionDto[];
};

export type GetSessionResponse = {
  session: CoachSessionDto;
};

export type CreateTurnRequest = {
  actorAnswer: string;
};

export type CreateTurnResponse = {
  actorTurn: TurnDto;
  coachTurn: TurnDto;
  session: CoachSessionDto;
  dialogueComplete: boolean;
  answerCount: number;
  completionReason: DialogueCompletionReason;
};

export type UpdateObservationRequest = {
  confirmationState: ConfirmationState;
};

export type UpdateObservationResponse = {
  observation: ObservationDto;
  session: CoachSessionDto;
};

export type CreateSummaryRequest = {
  finalActorSentence: string;
  validationMetrics?: SaveValidationMetricsRequest;
};

export type CreateSummaryResponse = {
  session: CoachSessionDto;
  nextReflectionQuestion: string;
};

export type SoftHideSessionResponse = {
  session: CoachSessionDto;
};

export type SignedVideoUrlResponse = {
  signedUrl: string | null;
  expiresAt: string;
  expiresInSeconds: number;
};

export type UpdateSessionVisibilityRequest = {
  hidden: boolean;
};

export type UpdateSessionVisibilityResponse = {
  session: CoachSessionDto;
};

export type SaveValidationMetricsRequest = Partial<ValidationMetricsDto>;

export type SaveValidationMetricsResponse = {
  session: CoachSessionDto;
  validationMetrics: ValidationMetricsDto;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
};
