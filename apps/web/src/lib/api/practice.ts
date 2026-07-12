import type {
  CreateUploadIntentRequest,
  CreateUploadIntentResponse,
  GetSessionResponse,
  ListSessionsResponse,
  SignedVideoUrlResponse,
  UpdateSessionVisibilityResponse,
} from "./types";
import type {
  CreateSessionRequest, CreateSessionResponse, CreateSummaryRequest, CreateSummaryResponse,
  CreateTurnRequest, CreateTurnResponse, UpdateObservationRequest, UpdateObservationResponse,
} from "./legacy-types";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "요청을 처리하지 못했어요.";
    throw new Error(message);
  }

  return payload as T;
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

export async function createPracticeUploadIntent(
  body: CreateUploadIntentRequest,
): Promise<CreateUploadIntentResponse> {
  const response = await fetch("/api/v1/practice-upload-intents", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateUploadIntentResponse>(response);
}

export async function listPracticeSessions(): Promise<ListSessionsResponse> {
  const response = await fetch("/api/v1/practice-sessions", {
    headers: { Accept: "application/json" },
  });

  return parseJsonResponse<ListSessionsResponse>(response);
}

export async function finalizePracticeSession(
  body: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const response = await fetch("/api/v1/practice-sessions", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateSessionResponse>(response);
}

export async function getPracticeSession(sessionId: string): Promise<GetSessionResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}`, {
    headers: { Accept: "application/json" },
  });

  return parseJsonResponse<GetSessionResponse>(response);
}

export async function softHidePracticeSession(
  sessionId: string,
): Promise<UpdateSessionVisibilityResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/visibility`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ hidden: true }),
  });

  return parseJsonResponse<UpdateSessionVisibilityResponse>(response);
}

export async function createPracticeSignedVideoUrl(
  sessionId: string,
): Promise<SignedVideoUrlResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/signed-video-url`, {
    headers: { Accept: "application/json" },
  });

  return parseJsonResponse<SignedVideoUrlResponse>(response);
}

export async function updatePracticeSessionObservation(
  sessionId: string,
  observationId: string,
  body: UpdateObservationRequest,
): Promise<UpdateObservationResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/observations/${observationId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

  return parseJsonResponse<UpdateObservationResponse>(response);
}

export async function createPracticeSessionTurn(
  sessionId: string,
  body: CreateTurnRequest,
): Promise<CreateTurnResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/turns`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateTurnResponse>(response);
}

export async function createPracticeSessionResult(
  sessionId: string,
  body: CreateSummaryRequest,
): Promise<CreateSummaryResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/result`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateSummaryResponse>(response);
}
