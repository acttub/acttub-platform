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

class UnauthorizedError extends ApiError {
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

/**
 * 오류를 화면에 보일 한 줄로 바꾼다.
 *
 * `ApiError` 는 서버가 준 detail 을 message 로 들고 오므로 대개 그대로 쓸 수 있지만,
 * 빈 문자열이면 화면에 아무 말도 뜨지 않는다 — 그때는 부르는 자리가 준 문구로 돌아간다.
 * `cause instanceof Error ? cause.message : fallback` 으로 적은 자리들이 이 빈 문구를
 * 그대로 그렸다.
 */
export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
