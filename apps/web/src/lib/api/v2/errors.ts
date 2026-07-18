export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: unknown,
    readonly requestId?: string,
  ) {
    super(typeof detail === "string" ? detail : code);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(
    message = "네트워크 요청에 실패했습니다.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NetworkError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(code: string, detail: unknown, requestId?: string) {
    super(401, code, detail, requestId);
    this.name = "UnauthorizedError";
  }
}

function getFastApiDetail(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  return "detail" in payload ? payload.detail : undefined;
}

export function toApiError(
  status: number,
  payload: unknown,
  requestId?: string,
): ApiError {
  const detail = getFastApiDetail(payload);
  const code =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? "validation_error"
        : "unknown_error";

  return status === 401
    ? new UnauthorizedError(code, detail, requestId)
    : new ApiError(status, code, detail, requestId);
}

export function isStillProcessing(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === "request is still processing"
  );
}

export function isRateLimited(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429;
}
