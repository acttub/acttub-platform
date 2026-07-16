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

type Guard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isNullableNumber = (value: unknown): value is number | null => value === null || isNumber(value);
const isStringIn = (value: unknown, options: readonly string[]) =>
  isString(value) && options.includes(value);

function isReport(value: unknown): value is ActingReportDto {
  return isRecord(value) &&
    isString(value.headline) &&
    isRecord(value.biggestProblem) &&
    isString(value.biggestProblem.start) &&
    isString(value.biggestProblem.end) &&
    isString(value.biggestProblem.dimension) &&
    isString(value.biggestProblem.description) &&
    isString(value.evidence) &&
    isString(value.selfDiscovery) &&
    isString(value.encouragement) &&
    isString(value.nextStep) &&
    isString(value.comparison) &&
    isNumber(value.reportCount);
}

function isActingSession(value: unknown): value is ActingCoachSessionDto {
  if (!isRecord(value) ||
    !isString(value.id) ||
    !isString(value.userId) ||
    value.pipelineVersion !== "acting-api-v1" ||
    value.legacy !== false ||
    !isStringIn(value.status, ["ANALYZING", "INTERVIEW", "REPORT", "END"]) ||
    !isStringIn(value.medium, ["연극", "영화", "TV 드라마", "웹드라마", "뮤지컬", "기타"]) ||
    !isStringIn(value.genre, ["드라마", "코미디", "로맨스", "스릴러", "액션", "판타지", "기타"]) ||
    !isString(value.situation) ||
    !isString(value.characterContext) ||
    !isString(value.subtext) ||
    !isNullableString(value.hiddenAt) ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt) ||
    !isRecord(value.take) ||
    !isString(value.take.id) ||
    !isNumber(value.take.durationMs) ||
    !isStringIn(value.take.analysisStatus, ["pending", "completed", "failed", "outcome_unknown"]) ||
    !isBoolean(value.take.analysisRetryable) ||
    !isNullableString(value.take.analysisError) ||
    !isString(value.take.createdAt)) {
    return false;
  }

  const sceneSummary = value.sceneSummary;
  if (sceneSummary !== null && (!isRecord(sceneSummary) ||
    !isRecord(sceneSummary.observation) ||
    !isString(sceneSummary.summary) ||
    !isString(sceneSummary.intent_alignment) ||
    !isString(sceneSummary.key_moment) ||
    !isString(sceneSummary.key_dimension) ||
    !Array.isArray(sceneSummary.anomalies) ||
    !sceneSummary.anomalies.every(isRecord))) {
    return false;
  }

  const currentRun = value.currentRun;
  if (currentRun !== null && (!isRecord(currentRun) ||
    !isString(currentRun.runId) ||
    !isStringIn(currentRun.status, ["starting", "live", "completed", "start_failed", "expired", "outcome_unknown"]) ||
    !isNullableString(currentRun.closeReason) ||
    !isNullableString(currentRun.failureCode) ||
    !isBoolean(currentRun.failureRetryable) ||
    !(currentRun.recoveryAction === null || isStringIn(currentRun.recoveryAction, ["start", "restart"])))) {
    return false;
  }

  return Array.isArray(value.turns) && value.turns.every((turn) =>
    isRecord(turn) &&
    isString(turn.id) &&
    isString(turn.runId) &&
    isNumber(turn.ordinal) &&
    isStringIn(turn.role, ["ai", "actor"]) &&
    isString(turn.text) &&
    isStringIn(turn.deliveryStatus, ["pending", "completed", "failed", "outcome_unknown"]) &&
    (turn.deliveryRetryable === undefined || isBoolean(turn.deliveryRetryable)) &&
    (turn.deliveryErrorCode === undefined || isNullableString(turn.deliveryErrorCode)) &&
    (turn.action === undefined || turn.action === null || isStringIn(turn.action, ["probe_intent", "dig_cause", "deflect", "close"])) &&
    (turn.focusTimestamp === undefined || isNullableString(turn.focusTimestamp)) &&
    isString(turn.createdAt)) &&
    (value.report === null || isReport(value.report));
}

function isLegacySession(value: unknown): value is LegacyCoachSessionDto {
  if (!isRecord(value) ||
    !isString(value.id) ||
    !isString(value.userId) ||
    value.pipelineVersion !== "legacy-gemini-v1" ||
    value.legacy !== true ||
    !isStringIn(value.status, ["LEGACY_OBSERVATIONS_PENDING", "LEGACY_QUESTIONING", "LEGACY_COMPLETED"]) ||
    !isStringIn(value.medium, ["youtube_url", "upload_url", "text_only"]) ||
    !isString(value.genre) ||
    !isString(value.situation) ||
    !isString(value.characterContext) ||
    !isString(value.subtext) ||
    !isNullableString(value.hiddenAt) ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt) ||
    !isRecord(value.take) ||
    !isString(value.take.id) ||
    !isString(value.take.sessionId) ||
    !isNullableString(value.take.videoUrl) ||
    !isNullableNumber(value.take.durationMs) ||
    !isStringIn(value.take.analysisStatus, ["generated", "failed"]) ||
    !isNullableString(value.take.analysisError) ||
    !isString(value.take.createdAt) ||
    value.sceneSummary !== null ||
    value.currentRun !== null ||
    !Array.isArray(value.turns) ||
    value.turns.length !== 0 ||
    value.report !== null) {
    return false;
  }
  return value.legacyResult === null || (isRecord(value.legacyResult) &&
    isString(value.legacyResult.actorAuthoredSentence) &&
    isNullableString(value.legacyResult.questionToRevisit) &&
    isString(value.legacyResult.createdAt));
}

const isUploadIntentResponse: Guard<CreateUploadIntentResponse> = (value): value is CreateUploadIntentResponse => {
  if (!isRecord(value) || !isRecord(value.uploadIntent)) return false;
  const intent = value.uploadIntent;
  return isString(intent.uploadIntentId) &&
    isString(intent.sessionId) &&
    isString(intent.userId) &&
    intent.storageBucket === "practice-videos" &&
    isString(intent.storagePath) &&
    isString(intent.uploadUrl) &&
    isRecord(intent.fileMetadata) &&
    isString(intent.fileMetadata.fileName) &&
    isStringIn(intent.fileMetadata.mimeType, ["video/mp4", "video/quicktime"]) &&
    isNumber(intent.fileMetadata.sizeBytes) &&
    (intent.fileMetadata.durationMs === undefined || isNumber(intent.fileMetadata.durationMs)) &&
    isStringIn(intent.status, ["created", "finalized", "expired"]) &&
    isNullableString(intent.finalizedAt) &&
    isRecord(intent.constraints) &&
    isNumber(intent.constraints.maxUploadBytes) &&
    Array.isArray(intent.constraints.allowedMimeTypes) &&
    intent.constraints.allowedMimeTypes.every(isString) &&
    isString(intent.expiresAt);
};

const isFinalizeUploadIntentResponse: Guard<FinalizeUploadIntentResponse> =
  (value): value is FinalizeUploadIntentResponse => isRecord(value) &&
    isString(value.videoUrl) &&
    isString(value.storagePath) &&
    isNullableNumber(value.durationMs);

const isSessionListPage: Guard<PracticeSessionListPageDto> =
  (value): value is PracticeSessionListPageDto => isRecord(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every((session) => isRecord(session) &&
      isString(session.id) &&
      isStringIn(session.pipelineVersion, ["acting-api-v1", "legacy-gemini-v1"]) &&
      isBoolean(session.legacy) &&
      isStringIn(session.status, ["ANALYZING", "INTERVIEW", "REPORT", "END", "LEGACY_OBSERVATIONS_PENDING", "LEGACY_QUESTIONING", "LEGACY_COMPLETED"]) &&
      isString(session.title) &&
      isNullableString(session.preview) &&
      isNullableNumber(session.durationMs) &&
      (session.analysisStatus === null || isStringIn(session.analysisStatus, ["pending", "completed", "failed", "outcome_unknown", "generated"])) &&
      isString(session.createdAt) &&
      isString(session.updatedAt)) &&
    isNullableString(value.nextCursor);

const isGetSessionResponse: Guard<{ session: PracticeSession }> =
  (value): value is { session: PracticeSession } => isRecord(value) &&
    (isActingSession(value.session) || isLegacySession(value.session));

async function parseJsonResponse<T>(response: Response, guard: Guard<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw response.ok
      ? new ApiClientError("응답을 확인하지 못했어요.", response.status, "invalid_response")
      : new ApiClientError("요청을 처리하지 못했어요.", response.status, "unknown_error");
  }
  if (!response.ok) {
    if (!isRecord(payload) || !isRecord(payload.error) ||
      !isString(payload.error.code) || !isString(payload.error.message) ||
      !(payload.error.details === undefined || isRecord(payload.error.details))) {
      throw new ApiClientError("요청을 처리하지 못했어요.", response.status, "unknown_error");
    }
    throw new ApiClientError(
      payload.error.message,
      response.status,
      payload.error.code,
      payload.error.details,
    );
  }
  if (!guard(payload)) {
    throw new ApiClientError("응답을 확인하지 못했어요.", response.status, "invalid_response");
  }
  return payload;
}

const jsonHeaders = { Accept: "application/json", "Content-Type": "application/json" };
const request = <T>(url: string, guard: Guard<T>, init?: RequestInit) =>
  fetch(url, { cache: "no-store", ...init }).then((response) => parseJsonResponse(response, guard));

export function createPracticeUploadIntent(body: CreateUploadIntentRequest) {
  return request("/api/v1/practice-upload-intents", isUploadIntentResponse, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function finalizePracticeUploadIntent(id: string, body: FinalizeUploadIntentRequest) {
  return request(`/api/v1/practice-upload-intents/${id}/finalize`, isFinalizeUploadIntentResponse, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function listPracticeSessions(options: { limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams("view=summary");
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor) query.set("cursor", options.cursor);
  return request(`/api/v1/practice-sessions?${query}`, isSessionListPage);
}

export function getPracticeSession(id: string, signal?: AbortSignal) {
  return request(`/api/v1/practice-sessions/${id}`, isGetSessionResponse, { signal });
}

export function createPracticeSession(body: CreateActingSessionRequest) {
  return request("/api/v1/practice-sessions", isActingSession, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function retryPracticeAnalysis(sessionId: string, requestId: string) {
  const body: RetryAnalysisRequest = { operation: "retry", requestId };
  return request(`/api/v1/practice-sessions/${sessionId}/analysis`, isActingSession, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export function mutatePracticeTurn(
  sessionId: string,
  body: ActingTurnRequest,
) {
  return request(`/api/v1/practice-sessions/${sessionId}/turns`, isActingSession, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
}

export function createPracticeReport(sessionId: string, requestId: string) {
  const body: CreateReportRequest = { requestId };
  return request(
    `/api/v1/practice-sessions/${sessionId}/report`,
    isReport,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
  );
}
