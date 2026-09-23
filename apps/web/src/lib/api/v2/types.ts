import type { components } from "../v2-schema";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type LogoutRequest = components["schemas"]["LogoutRequest"];
export type ConsentRequest = components["schemas"]["ConsentRequest"];
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
/** 워크스페이스가 사용하는 화면 상태. 서버의 stage·analysis_status 와 구분한다. */
export type PracticeSessionStatus = "created" | "analyzing" | "analyzed" | "failed";

export type AnalysisReport = components["schemas"]["AnalysisReport"];
export type ExpressionReport = components["schemas"]["ExpressionReport"];
export type BlockedReport = components["schemas"]["BlockedReport"];
export type PublicPracticeNote = components["schemas"]["PublicPracticeNote"];
export type PracticeReport = AnalysisReport | ExpressionReport | BlockedReport | PublicPracticeNote;
export type SavedPracticeReport = AnalysisReport | ExpressionReport | PublicPracticeNote;
