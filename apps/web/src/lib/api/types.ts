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
  fileMetadata: FileMetadataDto;
};

export type CreateUploadIntentResponse = {
  uploadIntent: PracticeUploadIntentDto;
};

export type FinalizeUploadIntentRequest = {
  storagePath: string;
  durationMs?: number;
};

export type FinalizeUploadIntentResponse = {
  videoUrl: string;
  storagePath: string;
  durationMs: number | null;
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

export type CreateSessionResponse = {
  session: CoachSessionDto;
  firstQuestion: TurnDto;
};

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
