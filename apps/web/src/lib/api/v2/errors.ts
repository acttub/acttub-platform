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
 * 리딩 대본 등록·수정과 회차 시작·진행 저장의 422 사유(reading.script·reading.session). 웹은 게스트뿐이라 대본 수 한도는 게스트의 20개다.
 * 기기가 같은 한도를 먼저 검사하므로(src/lib/reading/draft.ts) 서버의 422 는 두 검사가 어긋났을 때만 온다.
 */
export const READING_SCRIPT_MESSAGES: Record<string, string> = {
  script_too_long: "대본이 너무 길어요. 원문 100,000자·줄 3,000개·배역 50명까지 저장할 수 있어요.",
  script_limit: "대본은 20개까지 저장할 수 있어요. 안 쓰는 대본을 지우면 다시 저장할 수 있어요.",
  no_characters: "배역이 하나도 없어요. 배역 이름을 적어 주세요.",
  invalid_characters: "배역 이름이 비어 있거나 다른 배역과 겹쳐요. 이름을 고쳐 주세요.",
  request_fingerprint_mismatch: "같은 요청으로 다른 대본이 저장돼 있어요. 대본을 다시 넣어 주세요.",
  // 회차(reading.session)
  empty_range: "고른 배역의 대사가 없어요. 다른 배역을 골라 주세요.",
  invalid_line: "이 회차의 구간에 없는 줄이에요. 대본을 다시 열어 주세요.",
  // 녹음(reading.recording)
  recording_too_long: "이 줄 녹음은 너무 길어 저장하지 않았어요.",
  recording_quota: "녹음 저장 공간이 가득 찼어요. 지난 녹음을 지우면 다시 저장할 수 있어요.",
  // 영상 보관함·연습(practice.record·library·start)
  video_too_large: "영상이 너무 커요(100MB 이내).",
  video_too_long: "영상이 너무 길어요(5분 이내).",
  video_quota: "보관함이 가득 찼어요. 영상을 지우거나 파일만 파기하면 다시 올릴 수 있어요.",
  video_in_use: "회차나 챌린지에 쓰인 영상이라 지울 수 없어요. 파일만 파기할 수 있어요.",
  video_not_ready: "이 영상은 아직 쓸 수 없어요. 다른 영상을 골라 주세요.",
  upload_expired: "올릴 자리가 만료됐어요. 영상을 처음부터 다시 올려 주세요.",
};
/** 409 코드 문구(practice.resume·practice.analyze) */
const CONFLICT_MESSAGES: Record<string, string> = {
  practice_in_progress: "진행 중인 회차가 있어요. 그 회차로 돌아가요.",
  analysis_not_ready: "영상을 분석해야 대화를 시작할 수 있어요.",
};
/** 변환(webm → m4a)이 실패했다. 행·객체는 없고 기기가 같은 요청 id 로 다시 시도한다. */
const AUDIO_CONVERSION_MESSAGE = "녹음을 저장하는 중이에요. 잠시 뒤 다시 시도해요.";
/** 닫힌 회차(completed·stopped)에 진행 저장을 보냈다. 새 회차를 시작해야 한다. */
const SESSION_CLOSED_MESSAGE = "이미 끝난 회차예요. 상세에서 새로운 연습을 시작해 주세요.";

/** 연결이 끊겨 답을 받지 못했을 때 화면에 보이는 말. 어느 요청이었는지는 배우에게 뜻이 없다. */
const NETWORK_ERROR_MESSAGE =
  "응답을 받지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.";

const HANGUL = /[가-힣]/;

/**
 * 오류를 화면에 보일 한 줄로 바꾼다. 화면 문구의 규칙은 여기 한 곳에만 둔다.
 *
 * 문구를 정해 둔 코드가 먼저다. 그 밖의 `ApiError` 는 서버가 준 detail 을 message 로 들고
 * 오는데, 그것은 배우가 읽는 말이 아니라 코드다(`internal_server_error`, `session is closed`,
 * 검증 오류의 `validation_error`). 그대로 그리면 코드 원문이 화면에 닿고, 404 에서는 무엇이
 * 없는지까지 드러난다 — 그래서 **한글이 없는 말은 부르는 자리가 준 문구로 돌아간다.** 한글이
 * 든 말은 그대로 보인다: 서버가 일부러 안내 문장으로 주는 detail(426 강제 업데이트)과 화면
 * 쪽 코드가 "~해요"로 적어 던진 것(`UploadError`)이다. 빈 문자열도 부르는 자리의 문구다 —
 * `cause instanceof Error ? cause.message : fallback` 으로 적은 자리들이 빈 줄을 그렸다.
 *
 * 코드 원문은 버려지지 않는다. `ApiError` 가 `code`·`detail`·`requestId` 를 그대로 든다.
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
    if (cause.status === 422 && cause.code in READING_SCRIPT_MESSAGES) {
      return READING_SCRIPT_MESSAGES[cause.code];
    }
    if (cause.status === 409 && cause.code === "session_closed") return SESSION_CLOSED_MESSAGE;
    if (cause.status === 409 && cause.code in CONFLICT_MESSAGES) return CONFLICT_MESSAGES[cause.code];
    if (cause.status === 503 && cause.code === "audio_conversion_failed") return AUDIO_CONVERSION_MESSAGE;
    if (cause.status === 429) {
      return cause.code === GUEST_DAILY_ANALYSIS_LIMIT
        ? "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요."
        : "잠시 뒤 다시 시도해 주세요.";
    }
  }
  // 아래 둘의 message 는 개발자가 읽는 말("…요청에 실패했습니다")이다. 화면에는 그리지 않는다.
  if (cause instanceof NetworkError) return NETWORK_ERROR_MESSAGE;
  // 멱등 계층의 기한 초과와 취소. 부르는 자리는 대개 취소를 먼저 걸러 내지만 여기까지 와도
  // 브라우저의 영어 문장이나 "멱등 요청 …초과했습니다"가 닿지 않게 한다.
  if (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  ) {
    return fallback;
  }
  return cause instanceof Error && HANGUL.test(cause.message)
    ? cause.message
    : fallback;
}
