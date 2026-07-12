import type { LegacyCoachSessionDto } from "./legacy-types";

export type AnalysisStatus = "pending" | "completed" | "failed";

export type ActingAnalysisStatus = AnalysisStatus | "outcome_unknown";
export type ActingSessionStatus = "ANALYZING" | "INTERVIEW" | "REPORT" | "END";
export type SceneMedium = "연극" | "영화" | "TV 드라마" | "웹드라마" | "뮤지컬" | "기타";
export type SceneGenre = "드라마" | "코미디" | "로맨스" | "스릴러" | "액션" | "판타지" | "기타";
export type CoachAction = "probe_intent" | "dig_cause" | "deflect" | "close";
export type CoachCloseReason = string | "session_expired";

export type SceneSummaryDto = {
  observation: Record<string, unknown>;
  summary: string;
  intent_alignment: string;
  key_moment: string;
  key_dimension: string;
  anomalies: Record<string, unknown>[];
  [key: string]: unknown;
};

export type PracticeTurnDto = {
  id: string;
  runId: string;
  ordinal: number;
  role: "ai" | "actor";
  text: string;
  deliveryStatus: "pending" | "completed" | "failed" | "outcome_unknown";
  deliveryErrorCode?: string | null;
  action?: CoachAction | null;
  focusTimestamp?: string | null;
  createdAt: string;
};

export type ActingReportDto = {
  headline: string;
  biggestProblem: { start: string; end: string; dimension: string; description: string };
  evidence: string;
  selfDiscovery: string;
  encouragement: string;
  nextStep: string;
  comparison: string;
  reportCount: number;
};

export type ActingTakeDto = {
  id: string;
  durationMs: number;
  analysisStatus: ActingAnalysisStatus;
  analysisRetryable: boolean;
  analysisError: string | null;
  createdAt: string;
};

export type ActingCoachSessionDto = {
  id: string;
  userId: string;
  pipelineVersion: "acting-api-v1";
  legacy: false;
  status: ActingSessionStatus;
  medium: SceneMedium;
  genre: SceneGenre;
  situation: string;
  characterContext: string;
  subtext: string;
  hiddenAt: string | null;
  createdAt: string;
  updatedAt: string;
  take: ActingTakeDto;
  sceneSummary: SceneSummaryDto | null;
  currentRun: {
    runId: string;
    status: "starting" | "live" | "completed" | "start_failed" | "expired" | "outcome_unknown";
    closeReason: CoachCloseReason | null;
    failureCode: string | null;
    failureRetryable: boolean;
    recoveryAction: "start" | "restart" | null;
  } | null;
  turns: PracticeTurnDto[];
  report: ActingReportDto | null;
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

export type CoachSessionDto = ActingCoachSessionDto | LegacyCoachSessionDto;

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
  durationMs: number;
};

export type CreateActingSessionRequest = {
  requestId: string;
  uploadIntentId: string;
  medium: SceneMedium;
  genre: SceneGenre;
  situation: string;
  characterContext: string;
  subtext: string;
};

export type RetryAnalysisRequest = { operation: "retry"; requestId: string };
export type ActingTurnRequest =
  | { operation: "start"; requestId: string }
  | { operation: "reply"; runId: string; requestId: string; text: string }
  | { operation: "retry_reply"; runId: string; requestId: string; actorTurnId: string }
  | { operation: "restart"; requestId: string };
export type CreateReportRequest = { requestId: string };

export type FinalizeUploadIntentResponse = {
  videoUrl: string;
  storagePath: string;
  durationMs: number | null;
};

export type ListSessionsResponse = {
  sessions: CoachSessionDto[];
};

export type GetSessionResponse = {
  session: CoachSessionDto;
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

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
