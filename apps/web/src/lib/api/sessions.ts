import type {
  CreateSessionRequest,
  CreateSessionResponse,
  CreateSummaryRequest,
  CreateSummaryResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  UpdateObservationRequest,
  UpdateObservationResponse,
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

export async function createPracticeSession(
  body: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const response = await fetch("/api/v1/sessions", {
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
