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

const GUEST_DAILY_ANALYSIS_LIMIT = "guest_daily_analysis_limit";
const GUEST_TRANSFERRED = "guest_transferred";

/** "옮겼어요" 안내의 본문. 막힌 요청의 오류 문구와 안내 화면이 같은 말을 쓴다. */
export const GUEST_TRANSFERRED_MESSAGE =
  "이 브라우저의 연습을 앱으로 옮겼어요. 이제 앱에서 이어서 볼 수 있어요.";

/** 앱으로 옮겨진 게스트의 토큰으로 온 요청. 액세스 토큰에는 403, 갱신에는 401 로 온다. */
export function isGuestTransferred(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === GUEST_TRANSFERRED;
}

/** 잠시 기다리면 풀리는 429. 게스트의 하루 분석 횟수는 자정까지 풀리지 않으므로 뺀다. */
export function isRateLimited(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 429 &&
    error.code !== GUEST_DAILY_ANALYSIS_LIMIT
  );
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
  if (cause instanceof ApiError) {
    if (cause.code === "client_contract_required") {
      return "새로고침하면 이 연습 노트를 열 수 있어요.";
    }
    // isGuestTransferred 를 쓰지 않는다 — 이미 ApiError 로 좁힌 값에 타입 가드를 걸면 아래가 never 가 된다.
    if (cause.code === GUEST_TRANSFERRED) return GUEST_TRANSFERRED_MESSAGE;
    // 게스트가 동의 시트를 닫았다. 같은 동작을 다시 하면 시트가 다시 뜬다.
    if (cause.status === 403 && cause.code === "consent_required") {
      return "동의해야 계속할 수 있어요. 다시 시도하면 동의 문서를 볼 수 있어요.";
    }
    if (cause.status === 429) {
      return cause.code === GUEST_DAILY_ANALYSIS_LIMIT
        ? "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요."
        : "잠시 뒤 다시 시도해 주세요.";
    }
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
