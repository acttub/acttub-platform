import type {
  ConfirmPipelineObservationRequest,
  CreatePipelineSessionRequest,
  CreatePipelineSessionResponse,
  CreateSummaryRequest,
  CreateSummaryResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  CreateUploadIntentRequest,
  CreateUploadIntentResponse,
  DeletePipelineSessionResponse,
  FinalizeUploadIntentRequest,
  FinalizeUploadIntentResponse,
  GetPipelineSessionResponse,
  GetSessionResponse,
  ImmutablePipelineReportDto,
  ListSessionsResponse,
  PipelineDeletionAttemptDto,
  PipelineInterviewResponse,
  PipelineInterviewTurnRequest,
  SignedVideoUrlResponse,
  UpdateSessionVisibilityResponse,
  UpdateObservationRequest,
  UpdateObservationResponse,
} from "./types";

export const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

export async function parseApiResponse<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* preserve the safe generic error */ }
  if (!response.ok) {
    const nested = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
    const message = typeof nested === "object" && nested !== null && "message" in nested && typeof nested.message === "string"
      ? nested.message
      : typeof nested === "string" ? nested : "요청을 처리하지 못했어요.";
    throw new Error(message);
  }
  return payload as T;
}

const get = <T>(path: string) => fetch(path, { headers: { Accept: "application/json" } }).then(parseApiResponse<T>);
const send = <T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, headers?: HeadersInit) =>
  fetch(path, { method, headers: { ...jsonHeaders, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(parseApiResponse<T>);

export async function createPracticeUploadIntent(body: CreateUploadIntentRequest): Promise<CreateUploadIntentResponse> {
  const response = await fetch("/api/v1/practice-upload-intents", {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
  return parseApiResponse<CreateUploadIntentResponse>(response);
}

export async function finalizePracticeUploadIntent(uploadIntentId: string, body: FinalizeUploadIntentRequest): Promise<FinalizeUploadIntentResponse> {
  const response = await fetch(`/api/v1/practice-upload-intents/${uploadIntentId}/finalize`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(body),
  });
  return parseApiResponse<FinalizeUploadIntentResponse>(response);
}

export function createPipelinePracticeSession(body: CreatePipelineSessionRequest): Promise<CreatePipelineSessionResponse> {
  return send("/api/v1/practice-sessions", "POST", body);
}

export function getPipelinePracticeSession(sessionId: string): Promise<GetPipelineSessionResponse> {
  return get(`/api/v1/practice-sessions/${sessionId}`);
}

export function confirmPipelineObservation(sessionId: string, observationId: string, body: ConfirmPipelineObservationRequest): Promise<GetPipelineSessionResponse["session"]> {
  return send(`/api/v1/practice-sessions/${sessionId}/observations/${observationId}/confirmation`, "POST", body);
}

export function startPipelineInterview(sessionId: string): Promise<PipelineInterviewResponse> {
  return send(`/api/v1/practice-sessions/${sessionId}/interview/start`, "POST");
}

export function appendPipelineInterviewTurn(sessionId: string, body: PipelineInterviewTurnRequest): Promise<PipelineInterviewResponse> {
  return send(`/api/v1/practice-sessions/${sessionId}/interview/turns`, "POST", body);
}

export function stopPipelineInterview(sessionId: string): Promise<PipelineInterviewResponse> {
  return send(`/api/v1/practice-sessions/${sessionId}/interview/stop`, "POST");
}

export function resumePipelineInterview(sessionId: string): Promise<PipelineInterviewResponse> {
  return send(`/api/v1/practice-sessions/${sessionId}/interview/resume`, "POST");
}

export function getPipelineReport(sessionId: string): Promise<ImmutablePipelineReportDto> {
  return get(`/api/v1/practice-sessions/${sessionId}/report`);
}

export function retryPipelineReport(sessionId: string): Promise<ImmutablePipelineReportDto> {
  return send(`/api/v1/practice-sessions/${sessionId}/report/retry`, "POST");
}

export function deletePipelinePracticeSession(sessionId: string, requestId: string): Promise<DeletePipelineSessionResponse> {
  return send(`/api/v1/practice-sessions/${sessionId}`, "DELETE", undefined, { "Idempotency-Key": requestId });
}

export function getPipelineDeletionStatus(sessionId: string, requestId: string): Promise<PipelineDeletionAttemptDto> {
  return get(`/api/v1/practice-sessions/${sessionId}/deletion/${requestId}`);
}

// Legacy lifecycle clients remain until the existing practice view migrates to the pipeline aggregate.
export function listPracticeSessions(): Promise<ListSessionsResponse> { return get("/api/v1/practice-sessions"); }
export function getPracticeSession(sessionId: string): Promise<GetSessionResponse> { return get(`/api/v1/practice-sessions/${sessionId}`); }
export function softHidePracticeSession(sessionId: string): Promise<UpdateSessionVisibilityResponse> { return send(`/api/v1/practice-sessions/${sessionId}/visibility`, "PATCH", { hidden: true }); }
export async function createPracticeSignedVideoUrl(sessionId: string): Promise<SignedVideoUrlResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/signed-video-url`, {
    headers: { Accept: "application/json" },
  });
  return parseApiResponse<SignedVideoUrlResponse>(response);
}
export function updatePracticeSessionObservation(sessionId: string, observationId: string, body: UpdateObservationRequest): Promise<UpdateObservationResponse> { return send(`/api/v1/practice-sessions/${sessionId}/observations/${observationId}`, "PATCH", body); }
export function createPracticeSessionTurn(sessionId: string, body: CreateTurnRequest): Promise<CreateTurnResponse> { return send(`/api/v1/practice-sessions/${sessionId}/turns`, "POST", body); }
export function createPracticeSessionResult(sessionId: string, body: CreateSummaryRequest): Promise<CreateSummaryResponse> { return send(`/api/v1/practice-sessions/${sessionId}/result`, "POST", body); }
