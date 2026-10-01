import type { components } from "../v2-schema";

export type ConsentRequest = components["schemas"]["ConsentRequest"];
export type ConsentDocument = components["schemas"]["ConsentDocument"];

export type GuestResponse = components["schemas"]["GuestResponse"];
export type TransferCodeResponse = components["schemas"]["TransferCodeResponse"];
export type RefreshTokenResponse = components["schemas"]["RefreshTokenResponse"];
export type ConsentDocumentsResponse = components["schemas"]["ConsentDocumentsResponse"];
export type ConsentNotice = components["schemas"]["ConsentNotice"];
export type ConsentNoticesResponse = components["schemas"]["ConsentNoticesResponse"];
export type ConsentEntryResponse = components["schemas"]["ConsentEntryResponse"];
export type ConsentEventResponse = components["schemas"]["ConsentEventResponse"];
/** 워크스페이스가 사용하는 화면 상태. 서버의 stage·analysis_status 와 구분한다. */
export type PracticeSessionStatus = "created" | "analyzing" | "analyzed" | "failed";

export type AnalysisReport = components["schemas"]["AnalysisReport"];
export type ExpressionReport = components["schemas"]["ExpressionReport"];
export type BlockedReport = components["schemas"]["BlockedReport"];
export type PublicPracticeNote = components["schemas"]["PublicPracticeNote"];
export type PracticeReport = AnalysisReport | ExpressionReport | BlockedReport | PublicPracticeNote;
