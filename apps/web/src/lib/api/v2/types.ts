import type { components } from "../v2-schema";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type LogoutRequest = components["schemas"]["LogoutRequest"];
export type ConsentRequest = components["schemas"]["ConsentRequest"];
export type UploadIntentRequest = components["schemas"]["UploadIntentRequest"];
export type PracticeSessionRequest = components["schemas"]["PracticeSessionRequest"];
export type CoachStartReq = Omit<
  components["schemas"]["CoachStartReq"],
  "restart"
> & { restart?: boolean };
export type CoachReplyReq = components["schemas"]["CoachReplyReq"];
export type CoachConfirmReq = components["schemas"]["CoachConfirmReq"];
export type ReportReq = components["schemas"]["ReportReq"];

export type AuthUser = components["schemas"]["AuthUser"];
export type ConsentType = components["schemas"]["ConsentType"];
export type ConsentAction = components["schemas"]["ConsentAction"];
export type ConsentDocument = components["schemas"]["ConsentDocument"];
export type ConsentEntryDocument = components["schemas"]["ConsentEntryDocument"];
export type ConsentEntryStatus = components["schemas"]["ConsentEntryStatus"];

export type GuestResponse = components["schemas"]["GuestResponse"];
export type TransferCodeResponse = components["schemas"]["TransferCodeResponse"];
export type RefreshTokenResponse = components["schemas"]["RefreshTokenResponse"];
export type ConsentDocumentsResponse = components["schemas"]["ConsentDocumentsResponse"];
export type ConsentNotice = components["schemas"]["ConsentNotice"];
export type ConsentNoticesResponse = components["schemas"]["ConsentNoticesResponse"];
export type PendingConsentsResponse = components["schemas"]["ConsentDocumentsResponse"];
export type ConsentEntryResponse = components["schemas"]["ConsentEntryResponse"];
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
export type AnalysisErrorCode = NonNullable<
  components["schemas"]["PracticeSessionDetail"]["error_code"]
>;
export type PracticeSessionDetail = components["schemas"]["PracticeSessionDetail"];

export type CoachTurnResponse = components["schemas"]["CoachTurnResponse"];
export type CoachConfirmResponse = components["schemas"]["CoachConfirmResponse"];

export type AnalysisReport = components["schemas"]["AnalysisReport"];
export type ExpressionReport = components["schemas"]["ExpressionReport"];
export type BlockedReport = components["schemas"]["BlockedReport"];
export type PublicPracticeNote = components["schemas"]["PublicPracticeNote"];
export type PracticeReport = AnalysisReport | ExpressionReport | BlockedReport | PublicPracticeNote;
export type SavedPracticeReport = AnalysisReport | ExpressionReport | PublicPracticeNote;
export type ReportDetailResponse = components["schemas"]["ReportDetailResponse"];
export type ReportRecord = components["schemas"]["ReportRecord"];
export type ReportHistoryResponse = components["schemas"]["ReportHistoryResponse"];
