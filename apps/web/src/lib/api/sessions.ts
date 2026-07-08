import type {
  CreateSessionRequest,
  CreateSessionResponse,
  CreateSummaryRequest,
  CreateSummaryResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  CreateUploadIntentRequest,
  CreateUploadIntentResponse,
  FinalizeUploadIntentRequest,
  FinalizeUploadIntentResponse,
  ListSessionsResponse,
  SaveValidationMetricsRequest,
  SaveValidationMetricsResponse,
  SignedVideoUrlResponse,
  UpdateObservationRequest,
  UpdateObservationResponse,
  UpdateSessionVisibilityRequest,
  UpdateSessionVisibilityResponse,
} from "./types";

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

export async function createPracticeUploadIntent(
  body: CreateUploadIntentRequest,
): Promise<CreateUploadIntentResponse> {
  const response = await fetch("/api/v1/practice-upload-intents", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateUploadIntentResponse>(response);
}

export async function finalizePracticeUploadIntent(
  uploadIntentId: string,
  body: FinalizeUploadIntentRequest,
): Promise<FinalizeUploadIntentResponse> {
  const response = await fetch(`/api/v1/practice-upload-intents/${uploadIntentId}/finalize`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<FinalizeUploadIntentResponse>(response);
}

export async function listPracticeSessions(): Promise<ListSessionsResponse> {
  const response = await fetch("/api/v1/practice-sessions", {
    headers: { Accept: "application/json" },
  });

  return parseJsonResponse<ListSessionsResponse>(response);
}

export async function createPracticeSession(
  body: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const response = await fetch("/api/v1/practice-sessions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateSessionResponse>(response);
}

export async function updatePracticeObservation(
  sessionId: string,
  observationId: string,
  body: UpdateObservationRequest,
): Promise<UpdateObservationResponse> {
  const response = await fetch(`/api/v1/sessions/${sessionId}/observations/${observationId}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<UpdateObservationResponse>(response);
}

export async function createPracticeTurn(
  sessionId: string,
  body: CreateTurnRequest,
): Promise<CreateTurnResponse> {
  const response = await fetch(`/api/v1/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateTurnResponse>(response);
}

export async function createPracticeSummary(
  sessionId: string,
  body: CreateSummaryRequest,
): Promise<CreateSummaryResponse> {
  const response = await fetch(`/api/v1/sessions/${sessionId}/summary`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<CreateSummaryResponse>(response);
}

export async function updatePracticeSessionVisibility(
  sessionId: string,
  body: UpdateSessionVisibilityRequest,
): Promise<UpdateSessionVisibilityResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/visibility`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<UpdateSessionVisibilityResponse>(response);
}

export async function getPracticeSignedVideoUrl(
  sessionId: string,
): Promise<SignedVideoUrlResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/signed-video-url`, {
    headers: { Accept: "application/json" },
  });

  return parseJsonResponse<SignedVideoUrlResponse>(response);
}

export async function savePracticeValidationMetrics(
  sessionId: string,
  body: SaveValidationMetricsRequest,
): Promise<SaveValidationMetricsResponse> {
  const response = await fetch(`/api/v1/practice-sessions/${sessionId}/metrics`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<SaveValidationMetricsResponse>(response);
}
