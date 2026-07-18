import type { components } from "../v2-schema";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type LogoutRequest = components["schemas"]["LogoutRequest"];
export type ConsentRequest = components["schemas"]["ConsentRequest"];
export type UploadIntentRequest = components["schemas"]["UploadIntentRequest"];
export type PracticeSessionRequest = components["schemas"]["PracticeSessionRequest"];
export type CoachStartReq = components["schemas"]["CoachStartReq"];
export type CoachReplyReq = components["schemas"]["CoachReplyReq"];
export type ReportReq = components["schemas"]["ReportReq"];

export type AuthUser = {
  id: string;
  email: string | null;
  status: "active" | "suspended";
};

export type ConsentType = "terms" | "privacy" | "ai_analysis";
export type ConsentAction = ConsentRequest["action"];

export type ConsentDocument = {
  id: string;
  type: ConsentType;
  version: string;
  title: string;
  body: string;
  required: boolean;
  published_at: string;
};

export type TokenPairResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
  pending_consents: ConsentDocument[];
};

export type RefreshTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type ConsentDocumentsResponse = {
  documents: ConsentDocument[];
};

export type ConsentEventResponse = {
  id: string;
  document_id: string;
  action: ConsentAction;
  occurred_at: string;
};

export type UploadIntentResponse = {
  intent_id: string;
  upload_url: string;
  expires_at: string;
};

export type UploadCompleteResponse = {
  intent_id: string;
  status: "finalized";
};

export type PracticeSessionStatus =
  | "created"
  | "analyzing"
  | "analyzed"
  | "failed";

export type PracticeSessionCreateResponse = {
  session_id: string;
  status: PracticeSessionStatus;
  summary_id?: string;
};

export type PracticeSessionListItem = {
  session_id: string;
  status: PracticeSessionStatus;
  situation: string;
  character_context: string;
  subtext: string;
  created_at: string;
  updated_at: string;
};

export type PracticeSessionListResponse = {
  sessions: PracticeSessionListItem[];
};

export type SceneSummary = {
  summary_id: string;
  observation?: Record<string, unknown>;
  summary?: string;
  intent_alignment?: string;
  key_moment?: string;
  key_dimension?: string;
  anomalies?: unknown[];
} & Record<string, unknown>;

export type AnalysisErrorCode =
  | "gemini_timeout"
  | "gemini_parse_error"
  | "unsupported_media"
  | "max_attempts_exceeded";

export type PracticeSessionDetail = PracticeSessionListItem & {
  playback_url: string;
  summary?: SceneSummary;
  error_code?: AnalysisErrorCode | null;
};

export type CoachAction =
  | "probe_intent"
  | "dig_cause"
  | "deflect"
  | "close";

export type CoachReason =
  | "gap_stated"
  | "exhausted"
  | "limit"
  | "user_ended"
  | null;

export type CoachTurnResponse = {
  session_id: string;
  action: CoachAction;
  utterance: string;
  focus_timestamp: string;
  done: boolean;
  reason: CoachReason;
};

export type ActingReport = {
  headline: string;
  biggest_problem: {
    start: string;
    end: string;
    dimension: string;
    description: string;
  };
  evidence: string;
  self_discovery: string;
  encouragement: string;
  next_step: string;
  comparison: string;
};

export type CreateReportResponse = {
  report: ActingReport;
  report_count: number;
};

export type ReportRecord = {
  created_at: string;
  session_id: string;
  report: ActingReport;
  turns: unknown[];
};

export type ReportHistoryResponse = {
  count: number;
  reports: ReportRecord[];
};
