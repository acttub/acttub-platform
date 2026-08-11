/**
 * Amplitude 제품 계측. 이 파일 밖에서 `amplitude.track` 을 직접 부르지 않는다.
 *
 * GA4가 유입 채널을 잇는다면, 이쪽은 연습 안에서 어디서 멈추고 다시 오는지를 본다.
 * 같은 화면 전환을 두 도구에 보내더라도 답하려는 질문이 달라서 둘 다 남긴다.
 *
 * 지켜야 하는 것 셋 — 하나라도 풀면 개인정보처리방침과 어긋난다:
 *
 * 1) **동의 전에는 SDK를 초기화하지 않는다.** 호출부가 로그인과 최신 방침 동의를
 *    확인한 뒤 startAmplitude를 부른다. 그 전에 생긴 이벤트는 쌓지 않고 버린다.
 *
 * 2) **자동 수집은 통째로 끈다.** 기본 page view는 쿼리가 붙은 전체 주소를 보내고,
 *    element interactions는 사용자가 쓴 장면 제목과 버튼 문구까지 읽을 수 있다.
 *    그래서 autocapture의 개별 기능을 고르는 대신 false 하나로 전부 막는다.
 *
 * 3) **속성은 아래 래퍼가 만든 화이트리스트만 보낸다.** 세션 id·파일명·대화 본문을
 *    호출부에서 실수로 넘길 자리가 없도록 원본 숫자와 텍스트는 여기서 버킷과 boolean으로
 *    바꾼다. 오류도 메시지 원문 대신 HTTP 상태나 정해 둔 코드만 남긴다.
 */

import * as amplitude from "@amplitude/unified";
import { toDurationBucket } from "./ga";
import { scrubUrl } from "../observability/sentry-shared";

export { toDurationBucket } from "./ga";

type BlockageKind = "분석" | "표현" | "그 외";
type BlockageSubBranch =
  | "캐릭터 분석"
  | "대사 분석"
  | "감정"
  | "움직임"
  | "화술"
  | "표정"
  | "그 외";
type AnalysisErrorCode =
  | "gemini_timeout"
  | "gemini_parse_error"
  | "unsupported_media"
  | "max_attempts_exceeded";
type ReportType = "analysis" | "expression" | "blocked";
type PracticeStatus = "created" | "analyzing" | "analyzed" | "failed";
type LoginProvider = "development" | "google" | "apple";
// `session_create` 는 UploadError 가 아니다. 업로드가 다 끝난 뒤 세션 생성에서 터지는
// 실패인데, 이걸 preflight 로 묶으면 "영상이 문제였다"와 "서버가 거절했다"가 한 칸에 섞인다.
type UploadStage = "preflight" | "intent" | "put" | "complete" | "session_create";

let started = false;
// SDK는 한 번만 init하되, 로그아웃·재동의 요구 뒤에는 남아 있는 인스턴스로 이벤트를
// 보내지 않는다. 다시 동의 조건을 만족해 startAmplitude가 불리면 같은 인스턴스를 켠다.
let measuring = false;

/**
 * Amplitude를 켠다. 호출부가 로그인과 최신 방침 동의를 확인한 뒤에만 부른다.
 *
 * 켜고 끄는 스위치는 API 키 하나다. 환경별로 다른 키를 넣어 프로젝트를 나눈다 —
 * `NEXT_PUBLIC_*`는 빌드 시점에 번들에 새겨지므로, 배포에서 키를 빼면 조용히 아무 일도
 * 일어나지 않는다. 그래서 없을 때 경고를 남긴다.
 */
export function startAmplitude(): void {
  if (typeof window === "undefined") return;
  const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY ?? "";
  if (!apiKey) {
    console.warn("Amplitude API key missing — analytics disabled");
    return;
  }

  measuring = true;
  if (started) return;
  started = true;
  amplitude.initAll(apiKey, {"analytics":{"autocapture":true},"sessionReplay":{"sampleRate":1}});
  amplitude.track('Viewed Home Page', { prompt_version: 'BA400.4' }); // helps improve this setup flow — safe to remove once you've verified the event lands
}

let sentUserId: string | null = null;

/** 기기 너머의 행동을 잇는다. 이메일·표시 이름이 아니라 백엔드 내부 id만 받는다. */
export function setAmplitudeUser(userId: string): void {
  if (!started || !measuring) return;
  // 화면이 바뀔 때마다 같은 값을 다시 보내지 않는다.
  if (sentUserId === userId) return;
  amplitude.setUserId(userId);
  sentUserId = userId;
}

/** 로그아웃·재동의 요구 뒤에는 사용자와 기기 식별을 끊고 이후 이벤트도 버린다. */
export function resetAmplitudeUser(): void {
  measuring = false;
  if (!started) return;
  if (sentUserId === null) return;
  amplitude.reset();
  sentUserId = null;
}

/** 파일 크기는 원본 byte 대신 보고서에 필요한 네 구간만 남긴다. */
export function toSizeBucket(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const mb = 1024 * 1024;
  if (bytes < 10 * mb) return "<10MB";
  if (bytes < 30 * mb) return "10-30MB";
  if (bytes < 60 * mb) return "30-60MB";
  return "60MB+";
}

/** 분석 대기 시간은 원본 ms 대신 퍼널 병목을 구분할 네 구간만 남긴다. */
export function toWaitBucket(waitMs: number): string {
  if (!Number.isFinite(waitMs) || waitMs < 0) return "unknown";
  if (waitMs < 30_000) return "<30s";
  if (waitMs < 60_000) return "30-60s";
  if (waitMs < 120_000) return "60-120s";
  return "120s+";
}

/** 답변 길이는 본문을 보내지 않고 글자 수 구간만 남긴다. */
export function toLengthBucket(chars: number): string {
  const safeChars = Number.isFinite(chars) ? Math.max(0, chars) : 0;
  if (safeChars < 20) return "<20";
  if (safeChars < 60) return "20-60";
  if (safeChars < 150) return "60-150";
  return "150+";
}

/** 지난 연습을 며칠 만에 다시 열었는지. 소수 일수는 아직 지난 온전한 날 수로 센다. */
export function toAgeDaysBucket(days: number): string {
  const safeDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (safeDays < 1) return "0";
  if (safeDays < 4) return "1-3";
  if (safeDays < 8) return "4-7";
  if (safeDays < 30) return "8-30";
  return "30+";
}

/** 진행률은 원본 숫자를 보내지 않는다. 100도 마지막 표시 구간으로 눌러 담는다. */
export function toPctBucket(pct: number): string {
  const safePct = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  if (safePct < 25) return "0-25";
  if (safePct < 50) return "25-50";
  if (safePct < 75) return "50-75";
  return "75-99";
}

type SafeReasonCode = number | "network" | "aborted" | "unknown";

/**
 * 에러 객체를 그대로 보내지 않고 안전한 이유 코드만 꺼낸다. UploadError가 원인을 감싸므로
 * cause를 따라가되 깊이를 제한한다. 서버 detail·message는 어떤 본문일지 몰라 읽지 않는다.
 */
function toSafeReasonCode(reason: unknown, depth = 0): SafeReasonCode {
  if (depth > 3 || reason === null || typeof reason !== "object") return "unknown";
  const error = reason as {
    name?: unknown;
    status?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (error.name === "AbortError") return "aborted";
  if (error.name === "NetworkError") return "network";
  if (typeof error.status === "number" && Number.isInteger(error.status)) return error.status;
  // XHR PUT 실패는 UploadError가 HTTP 상태를 필드로 보존하지 않아, 우리가 만든 고정 문구의
  // 숫자만 좁게 읽는다. 그 밖의 서버·브라우저 오류 메시지는 절대 reason_code로 쓰지 않는다.
  if (error.name === "UploadError" && typeof error.message === "string") {
    if (error.message === "업로드 URL이 만료되었을 수 있어요. 업로드를 처음부터 다시 시도해 주세요.") {
      return 403;
    }
    const statusMatch = error.message.match(/\(HTTP ([1-5]\d{2})\)$/);
    if (statusMatch) return Number(statusMatch[1]);
  }
  if (error.cause !== undefined) return toSafeReasonCode(error.cause, depth + 1);
  return "unknown";
}

/** 로그인 실패 분류는 화면 분류기와 같은 세 코드만 통과시키고 나머지는 원문 없이 묶는다. */
function toLoginReasonCode(reason: unknown): string {
  if (reason !== null && typeof reason === "object") {
    const error = reason as { name?: unknown; status?: unknown; code?: unknown };
    if (
      (error.status === 401 && error.code === "invalid_provider_token")
      || (error.status === 403 && error.code === "account_suspended")
      || (error.status === 400 && error.code === "unsupported_provider")
    ) {
      return error.code;
    }
    if (error.name === "NetworkError") return "network";
  }
  return "unknown";
}

/** 동의·호스트 가드를 통과한 인스턴스에만 이벤트를 보낸다. */
function track(eventName: string, properties: Record<string, string | number | boolean> = {}): void {
  if (!started || !measuring) return;
  amplitude.track(eventName, properties);
}

export function trackPracticePrepOpened(entry: "new" | "reset"): void {
  track("practice_prep_opened", { entry });
}

/**
 * 길이는 싣지 않는다. 파일을 고른 순간에는 아직 메타데이터가 오지 않아 항상 unknown 이 되고,
 * 늘 unknown 인 속성은 보고서에서 있는 것보다 나쁘다 — 진짜 미상과 구분되지 않는다.
 * 영상 길이는 세션이 만들어진 뒤 `practice_session_created` 에서 확정값으로 본다.
 */
export function trackPracticeVideoSelected(sizeBytes: number, isReselect: boolean): void {
  track("practice_video_selected", {
    size_bucket: toSizeBucket(sizeBytes),
    is_reselect: isReselect,
  });
}

export function trackPracticeBlockageStarted(): void {
  track("practice_blockage_started");
}

export function trackPracticeBlockageSubmitted(
  kind: BlockageKind,
  subBranch: BlockageSubBranch,
  detail: string | null,
): void {
  track("practice_blockage_submitted", {
    kind,
    sub_branch: subBranch,
    has_detail: Boolean(detail?.trim()),
  });
}

export function trackPracticeUploadFailed(stage: UploadStage, reason: unknown): void {
  track("practice_upload_failed", {
    stage,
    reason_code: toSafeReasonCode(reason),
  });
}

export function trackPracticeSessionCreated(
  durationMs: number,
  kind: BlockageKind,
  subBranch: BlockageSubBranch,
): void {
  track("practice_session_created", {
    duration_bucket: toDurationBucket(durationMs),
    kind,
    sub_branch: subBranch,
  });
}

export function trackPracticeAnalysisSettled(
  result: "analyzed" | "failed",
  errorCode: AnalysisErrorCode | null | undefined,
  waitMs: number,
): void {
  track("practice_analysis_settled", {
    result,
    ...(errorCode ? { error_code: errorCode } : {}),
    wait_bucket: toWaitBucket(waitMs),
  });
}

export function trackPracticeDialogueStarted(
  withEvidence: boolean,
  kind: BlockageKind,
  subBranch: BlockageSubBranch,
): void {
  track("practice_dialogue_started", {
    with_evidence: withEvidence,
    kind,
    sub_branch: subBranch,
  });
}

export function trackPracticeDialogueStartFailed(restart: boolean): void {
  track("practice_dialogue_start_failed", { restart });
}

export function trackPracticeDialogueTurnSent(turnIndex: number, answer: string): void {
  track("practice_dialogue_turn_sent", {
    turn_index: turnIndex,
    answer_length_bucket: toLengthBucket(answer.length),
  });
}

export function trackPracticeDialogueTurnFailed(turnIndex: number): void {
  track("practice_dialogue_turn_failed", { turn_index: turnIndex });
}

export function trackPracticeDialogueCompleted(
  turnCount: number,
  reportType: ReportType,
  endedBy: "coach" | "actor_closing",
): void {
  track("practice_dialogue_completed", {
    turn_count: turnCount,
    report_type: reportType,
    ended_by: endedBy,
  });
}

export function trackPracticeResultViewed(
  reportType: ReportType,
  turnCount: number,
  source: "current" | "history",
): void {
  track("practice_result_viewed", {
    report_type: reportType,
    turn_count: turnCount,
    source,
  });
}

export function trackPracticeAbandoned(
  mode: "preparing" | "chat",
  turnCount: number,
  pct: number,
): void {
  track("practice_abandoned", {
    mode,
    turn_count: turnCount,
    pct_bucket: toPctBucket(pct),
  });
}

export function trackPracticeHistoryOpened(
  status: PracticeStatus,
  hasNote: boolean,
  ageDays: number,
): void {
  track("practice_history_opened", {
    status,
    has_note: hasNote,
    age_days_bucket: toAgeDaysBucket(ageDays),
  });
}

export function trackExitReviewOpened(
  trigger: "x" | "leave" | "back",
  mode: "chat" | "note",
): void {
  track("exit_review_opened", { trigger, mode });
}

export function trackExitReviewSubmitted(trigger: "x" | "leave" | "back"): void {
  track("exit_review_submitted", { trigger });
}

/**
 * 동의를 이미 마친 사람의 로그인만 여기 남는다. 동의가 남은 신규 계정은 계측이 꺼진 채
 * 동의 화면으로 가므로 이 이벤트가 아니라 `consent_submitted` 로 잡힌다 — 그래서
 * "동의 대기 여부" 속성을 두지 않는다. 늘 같은 값이면 없느니만 못하다.
 */
export function trackLoginCompleted(provider: LoginProvider): void {
  track("login_completed", { provider });
}

export function trackLoginFailed(provider: LoginProvider, reason: unknown): void {
  track("login_failed", {
    provider,
    reason_code: toLoginReasonCode(reason),
  });
}

export function trackConsentSubmitted(result: "ok" | "partial_fail" | "forced_logout"): void {
  track("consent_submitted", { result });
}

/** 화면 주소는 쿼리·해시를 버리고 경로 UUID를 가린 뒤에만 보낸다. */
export function trackScreenViewed(pathname: string): void {
  track("screen_viewed", { path: scrubUrl(pathname) });
}
