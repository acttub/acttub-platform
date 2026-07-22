import type { components } from "../v2-schema";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type LogoutRequest = components["schemas"]["LogoutRequest"];
export type ConsentRequest = components["schemas"]["ConsentRequest"];
export type UploadIntentRequest = components["schemas"]["UploadIntentRequest"];
export type PracticeSessionRequest = components["schemas"]["PracticeSessionRequest"];
export type CoachStartReq = components["schemas"]["CoachStartReq"];
export type CoachReplyReq = components["schemas"]["CoachReplyReq"];
export type ReportReq = components["schemas"]["ReportReq"];

export type AuthUser = components["schemas"]["AuthUser"];
export type ConsentType = components["schemas"]["ConsentType"];
export type ConsentAction = components["schemas"]["ConsentAction"];
export type ConsentDocument = components["schemas"]["ConsentDocument"];

export type TokenPairResponse = components["schemas"]["TokenPairResponse"];
export type RefreshTokenResponse = components["schemas"]["RefreshTokenResponse"];
export type ConsentDocumentsResponse = components["schemas"]["ConsentDocumentsResponse"];
export type PendingConsentsResponse = components["schemas"]["ConsentDocumentsResponse"];
export type ConsentEventResponse = components["schemas"]["ConsentEventResponse"];
export type UploadIntentResponse = components["schemas"]["UploadIntentResponse"];
export type UploadCompleteResponse = components["schemas"]["UploadCompleteResponse"];

export type PracticeSessionStatus =
  components["schemas"]["PracticeSessionListItem"]["status"];
export type PracticeSessionCreateResponse =
  components["schemas"]["PracticeSessionCreateResponse"];
export type PracticeSessionListItem = components["schemas"]["PracticeSessionListItem"];
export type PracticeSessionListResponse =
  components["schemas"]["PracticeSessionListResponse"];
export type SceneSummary = components["schemas"]["SceneSummary"];
export type AnalysisErrorCode = NonNullable<
  components["schemas"]["PracticeSessionDetail"]["error_code"]
>;
export type PracticeSessionDetail = components["schemas"]["PracticeSessionDetail"];

export type CoachAction = components["schemas"]["CoachTurnResponse"]["action"];
export type CoachReason = components["schemas"]["CoachTurnResponse"]["reason"];
export type CoachTurnResponse = components["schemas"]["CoachTurnResponse"];

export type ActingReport = components["schemas"]["ActingReport"];
export type CreateReportResponse = components["schemas"]["CreateReportResponse"];
export type ReportRecord = components["schemas"]["ReportRecord"];
export type ReportHistoryResponse = components["schemas"]["ReportHistoryResponse"];
