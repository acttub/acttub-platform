export type SceneMedium = "연극" | "영화" | "TV 드라마" | "웹드라마" | "뮤지컬" | "기타";
export type SceneGenre = "드라마" | "코미디" | "로맨스" | "스릴러" | "액션" | "판타지" | "기타";
export type ActingSessionStatus = "ANALYZING" | "INTERVIEW" | "REPORT" | "END";

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

export type PracticeTurn = {
  id: string;
  runId: string;
  ordinal: number;
  role: "ai" | "actor";
  text: string;
  deliveryStatus: "pending" | "completed" | "failed" | "outcome_unknown";
  deliveryErrorCode?: string | null;
  focusTimestampMs?: number | null;
  createdAt: string;
};

export type ActingReport = {
  [key: string]: unknown;
  id?: string;
  createdAt?: string;
};

export type ActingSession = {
  id: string;
  pipelineVersion: "acting-api-v1";
  legacy: false;
  status: ActingSessionStatus;
  medium: SceneMedium;
  genre: SceneGenre;
  situation: string;
  characterContext: string;
  subtext: string;
  createdAt: string;
  updatedAt: string;
  take: {
    analysisStatus: "pending" | "completed" | "failed" | "outcome_unknown";
    analysisError?: string | null;
    analysisRetryable: boolean;
  };
  currentRun: {
    runId: string;
    status: string;
    closeReason?: string | null;
    failureCode?: string | null;
    failureRetryable?: boolean;
    recoveryAction: "start" | "restart" | null;
  } | null;
  turns: PracticeTurn[];
  report?: ActingReport | null;
};

export type LegacySession = {
  id: string;
  pipelineVersion: "legacy-gemini-v1";
  legacy: true;
  status: "LEGACY_OBSERVATIONS_PENDING" | "LEGACY_QUESTIONING" | "LEGACY_COMPLETED";
  genre: string;
  situation: string;
  createdAt: string;
  updatedAt: string;
  report: null;
};

export type PracticeSession = ActingSession | LegacySession;

type UploadIntent = {
  uploadIntentId: string;
  sessionId: string;
  storageBucket: "practice-videos";
  storagePath: string;
};

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
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

export function createPracticeUploadIntent(body: {
  fileMetadata: { fileName: string; mimeType: "video/mp4" | "video/quicktime"; sizeBytes: number };
}) {
  return request<{ uploadIntent: UploadIntent }>("/api/v1/practice-upload-intents", {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function finalizePracticeUploadIntent(id: string, body: { storagePath: string; durationMs: number }) {
  return request(`/api/v1/practice-upload-intents/${id}/finalize`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function listPracticeSessions() {
  return request<{ sessions: PracticeSession[] }>("/api/v1/practice-sessions");
}

export function getPracticeSession(id: string) {
  return request<{ session: PracticeSession }>(`/api/v1/practice-sessions/${id}`);
}

export function createPracticeSession(body: {
  requestId: string; uploadIntentId: string; situation: string; characterContext: string;
  subtext: string; medium: SceneMedium; genre: SceneGenre;
}) {
  return request<{ session: ActingSession }>("/api/v1/practice-sessions", {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function retryPracticeAnalysis(sessionId: string) {
  return request<{ session: ActingSession }>(`/api/v1/practice-sessions/${sessionId}/analysis`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ operation: "retry", requestId: crypto.randomUUID() }),
  });
}

export function mutatePracticeTurn(
  sessionId: string,
  body:
    | { operation: "start" | "restart"; requestId: string }
    | { operation: "reply"; runId: string; requestId: string; text: string }
    | { operation: "retry_reply"; runId: string; requestId: string; actorTurnId: string },
) {
  return request<{ session: ActingSession }>(`/api/v1/practice-sessions/${sessionId}/turns`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function createPracticeReport(sessionId: string) {
  return request<{ session: ActingSession; report?: ActingReport }>(
    `/api/v1/practice-sessions/${sessionId}/report`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ requestId: crypto.randomUUID() }) },
  );
}
