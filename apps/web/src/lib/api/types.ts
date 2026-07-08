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
  feltHelpedFindGap1To7?: number;
  feltScored1To7?: number;
  rejectionSafety1To7?: number;
  answerability1To7?: number;
  reuseIntent1To7?: number;
  rejectedObservationReuseCount?: number;
  forbiddenLanguageCount?: number;
  finalSentenceResult?: "saved" | "skipped";
};

export type CoachSessionDto = {
  id: string;
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
  storageBucket: string;
  storagePath: string;
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

export type GetSessionResponse = {
  session: CoachSessionDto;
};

export type ListSessionsResponse = {
  sessions: CoachSessionDto[];
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
  validationMetrics?: ValidationMetricsDto;
};

export type CreateSummaryResponse = {
  session: CoachSessionDto;
  nextReflectionQuestion: string;
};

export type SoftHideSessionResponse = {
  session: CoachSessionDto;
};

export type SignedVideoUrlResponse = {
  signedUrl: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
};
