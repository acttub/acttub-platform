import type {
  ActingCoachSessionDto,
  ActingReportDto,
  ActingTurnRequest,
  CreateActingSessionRequest,
  CreateReportRequest,
  CreateUploadIntentRequest,
  CreateUploadIntentResponse,
  FinalizeUploadIntentRequest,
  FinalizeUploadIntentResponse,
  RetryAnalysisRequest,
  PracticeSessionListPageDto,
} from "./types";
import type { LegacyCoachSessionDto } from "./legacy-types";

export type { SceneGenre, SceneMedium } from "./types";

export type ApiErrorDetails = Record<string, unknown>;

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type PracticeSession = ActingCoachSessionDto | LegacyCoachSessionDto;

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string; details?: ApiErrorDetails };
  } | null;
  if (!response.ok) {
    throw new ApiClientError(
      payload?.error?.message ?? "요청을 처리하지 못했어요.",
      response.status,
      payload?.error?.code ?? "unknown_error",
      payload?.error?.details,
    );
  }
  return payload as T;
}

const jsonHeaders = { Accept: "application/json", "Content-Type": "application/json" };
const request = <T>(url: string, init?: RequestInit) =>
  fetch(url, { cache: "no-store", ...init }).then(parseJsonResponse<T>);

export function createPracticeUploadIntent(body: CreateUploadIntentRequest) {
  return request<CreateUploadIntentResponse>("/api/v1/practice-upload-intents", {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function finalizePracticeUploadIntent(id: string, body: FinalizeUploadIntentRequest) {
  return request<FinalizeUploadIntentResponse>(`/api/v1/practice-upload-intents/${id}/finalize`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function listPracticeSessions(options: { limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams("view=summary");
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor) query.set("cursor", options.cursor);
  return request<PracticeSessionListPageDto>(`/api/v1/practice-sessions?${query}`);
}

export function getPracticeSession(id: string, signal?: AbortSignal) {
  return request<{ session: PracticeSession }>(`/api/v1/practice-sessions/${id}`, { signal });
}

export function createPracticeSession(body: CreateActingSessionRequest) {
  return request<ActingCoachSessionDto>("/api/v1/practice-sessions", {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function retryPracticeAnalysis(sessionId: string, requestId: string) {
  const body: RetryAnalysisRequest = { operation: "retry", requestId };
  return request<ActingCoachSessionDto>(`/api/v1/practice-sessions/${sessionId}/analysis`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export function mutatePracticeTurn(
  sessionId: string,
  body: ActingTurnRequest,
) {
  return request<ActingCoachSessionDto>(`/api/v1/practice-sessions/${sessionId}/turns`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function createPracticeReport(sessionId: string, requestId: string) {
  const body: CreateReportRequest = { requestId };
  return request<ActingReportDto>(
    `/api/v1/practice-sessions/${sessionId}/report`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
  );
}
