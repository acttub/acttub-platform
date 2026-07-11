import type {
  CreatePipelineSessionRequest, CreateSessionRequest, CreateSessionResponse, CreateSummaryRequest, CreateSummaryResponse,
  CreateTurnRequest, CreateTurnResponse, CreateUploadIntentRequest, CreateUploadIntentResponse,
  FinalizeUploadIntentRequest, FinalizeUploadIntentResponse, ListSessionsResponse,
  SaveValidationMetricsRequest, SaveValidationMetricsResponse, SignedVideoUrlResponse,
  UpdateObservationRequest, UpdateObservationResponse, UpdateSessionVisibilityRequest,
  UpdateSessionVisibilityResponse,
} from "./types";
import { jsonHeaders, parseApiResponse } from "./practice";

export * from "./practice";

// Compatibility wrappers used by the existing practice view. They do not invent provider URLs or pipeline fields.
export function createPracticeUploadIntent(body: Omit<CreateUploadIntentRequest, "adultConfirmed" | "allParticipantsConfirmed"> & {
  adultConfirmed?: boolean; allParticipantsConfirmed?: boolean;
  fileMetadata: CreateUploadIntentRequest["fileMetadata"] & { durationMs?: number };
}): Promise<CreateUploadIntentResponse> {
  return fetch("/api/v1/practice-upload-intents", {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({
      fileMetadata: { fileName: body.fileMetadata.fileName, mimeType: body.fileMetadata.mimeType, sizeBytes: body.fileMetadata.sizeBytes },
      adultConfirmed: body.adultConfirmed === true, allParticipantsConfirmed: body.allParticipantsConfirmed === true,
      ...(body.uploadIntentId !== undefined ? { uploadIntentId: body.uploadIntentId } : {}),
      ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
    }),
  }).then(parseApiResponse<CreateUploadIntentResponse>);
}
export async function finalizePracticeUploadIntent(uploadIntentId: string, body: FinalizeUploadIntentRequest & { durationMs?: number }): Promise<FinalizeUploadIntentResponse & { videoUrl?: undefined }> {
  const response = await fetch(`/api/v1/practice-upload-intents/${uploadIntentId}/finalize`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ storagePath: body.storagePath }),
  });
  return parseApiResponse<FinalizeUploadIntentResponse>(response);
}
async function send<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  return fetch(path, { method, headers: jsonHeaders, body: JSON.stringify(body) }).then(parseApiResponse<T>);
}
async function get<T>(path: string): Promise<T> {
  return fetch(path, { headers: { Accept: "application/json" } }).then(parseApiResponse<T>);
}
export function listPracticeSessions(): Promise<ListSessionsResponse> { return get("/api/v1/practice-sessions"); }
function legacyPipelineRequest(body: CreateSessionRequest): CreatePipelineSessionRequest {
  const values = [body.sessionId, body.uploadIntentId, body.storagePath, body.genre, body.situation, body.characterContext];
  if (values.some((value) => typeof value !== "string" || !value.trim())) throw new Error("세션 요청 정보가 올바르지 않아요.");
  return {
    sessionId: body.sessionId!, uploadIntentId: body.uploadIntentId!, storagePath: body.storagePath!,
    genre: body.genre, situation: body.situation, characterContext: body.characterContext,
    ...(body.subtext ? { subtext: body.subtext } : {}),
  };
}
export function createPracticeSession(body: CreateSessionRequest): Promise<CreateSessionResponse> { return send("/api/v1/practice-sessions", "POST", legacyPipelineRequest(body)); }
export function updatePracticeObservation(sessionId: string, observationId: string, body: UpdateObservationRequest): Promise<UpdateObservationResponse> { return send(`/api/v1/practice-sessions/${sessionId}/observations/${observationId}`, "PATCH", body); }
export function createPracticeTurn(sessionId: string, body: CreateTurnRequest): Promise<CreateTurnResponse> { return send(`/api/v1/practice-sessions/${sessionId}/turns`, "POST", body); }
export function createPracticeSummary(sessionId: string, body: CreateSummaryRequest): Promise<CreateSummaryResponse> { return send(`/api/v1/practice-sessions/${sessionId}/result`, "POST", body); }
export function updatePracticeSessionVisibility(sessionId: string, body: UpdateSessionVisibilityRequest): Promise<UpdateSessionVisibilityResponse> { return send(`/api/v1/practice-sessions/${sessionId}/visibility`, "PATCH", body); }
export function getPracticeSignedVideoUrl(sessionId: string): Promise<SignedVideoUrlResponse> { return get(`/api/v1/practice-sessions/${sessionId}/signed-video-url`); }
export function savePracticeValidationMetrics(sessionId: string, body: SaveValidationMetricsRequest): Promise<SaveValidationMetricsResponse> { return send(`/api/v1/practice-sessions/${sessionId}/metrics`, "POST", body); }
