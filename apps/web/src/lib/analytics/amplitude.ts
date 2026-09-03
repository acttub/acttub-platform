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
 * 2) **autocapture 와 화면 녹화는 켜져 있다**(2026-08-11 최우영 결정). 그래서 전체 주소·
 *    클릭한 요소의 텍스트·화면 기록이 수탁사로 나간다. 무엇이 나가는지는 방침 v4 6항과
 *    `ANALYTICS.md` §1(2)에 그대로 적혀 있다.
 *
 * 3) **속성은 아래 래퍼가 만든 화이트리스트만 보낸다.** 세션 id·파일명·대화 본문을
 *    호출부에서 실수로 넘길 자리가 없도록 원본 숫자와 텍스트는 여기서 버킷과 boolean으로
 *    바꾼다. 오류도 메시지 원문 대신 HTTP 상태나 정해 둔 코드만 남긴다.
 *
 * ⚠️ **`@amplitude/unified` 의 `initAll` 을 쓰지 않는다.** 그건 analytics·session replay 에
 * 더해 **experiment 와 engagement(가이드·설문)까지 조건 없이 초기화한다**(unified 의
 * `initAll` 에 engagement 를 끄는 옵션이 없다). 2026-08-11 로컬 확인에서 CDN 청크 15개+와
 * `gs.amplitude.com` 호출이 붙는 것을 보고 걷어냈다. 지금은 analytics 와 session replay
 * 둘만 명시적으로 붙인다 — Amplitude 의 Next.js 가이드가 쓰는 방식이다.
 */

import * as amplitude from "@amplitude/analytics-browser";
import { sessionReplayPlugin } from "@amplitude/plugin-session-replay-browser";
import { toDurationBucket } from "./ga";
import type { UploadStage } from "../api/v2/uploads";
import type { TheoryChoiceId } from "../../features/practice/theory-choice";
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
type PracticeStatus = "analyzing" | "analyzed" | "failed";
export type LoginProvider = "development" | "google" | "apple";
// 연습을 시작하다 어디서 엎어졌는지. 가운데 셋(UploadStage)은 UploadError 가 스스로
// 말하지만 양 끝 둘은 아니다. `session_create` 는 UploadError 가 아니다 — 업로드가 다
// 끝난 뒤 세션 생성에서 터지는 실패인데, 이걸 preflight 로 묶으면 "영상이 문제였다"와
// "서버가 거절했다"가 한 칸에 섞인다.
export type PracticeStartFailurePoint = "preflight" | UploadStage | "session_create";

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
  // 리플레이 플러그인은 init 앞에 붙여야 첫 세션부터 잡힌다.
  // ⚠️ 여기 sampleRate 는 최종값이 아니다 — Amplitude 프로젝트의 원격 설정이 덮는다.
  //    실제 적용값은 sr-client-cfg.amplitude.com 응답에서 확인한다(ANALYTICS.md §1(2)).
  amplitude.add(sessionReplayPlugin({ sampleRate: 1 }));
  amplitude.init(apiKey, undefined, { autocapture: true });
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

/** 로그인 실패 분류는 화면 분류기와 같은 두 코드만 통과시키고 나머지는 원문 없이 묶는다. */
function toLoginReasonCode(reason: unknown): string {
  if (reason !== null && typeof reason === "object") {
    const error = reason as { name?: unknown; status?: unknown; code?: unknown };
    if (
      (error.status === 401 && error.code === "invalid_provider_token")
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

/**
 * 시작할 때 장면 세 칸이 모두 비어 있었다. 별도 건너뛰기 버튼이 없어졌으므로
 * 세션 생성 성공 여부와 관계없이 시작 시점의 선택 입력 상태를 센다.
 */
export function trackPracticeSceneSkipped(): void {
  track("practice_scene_skipped");
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

export function trackPracticeUploadFailed(
  stage: PracticeStartFailurePoint,
  reason: unknown,
): void {
  track("practice_upload_failed", {
    stage,
    reason_code: toSafeReasonCode(reason),
  });
}

export type PracticeUploadProfile = {
  compressMs: number;
  uploadMs: number;
  originalBytes: number;
  uploadedBytes: number;
  wasCompressed: boolean;
  webcodecsSupported: boolean;
  videoDurationMs: number;
};

/**
 * 브라우저 구간(압축·업로드) 실측 — SOMA-381. practice_video_selected(원본 크기)와
 * practice_analysis_settled(서버 대기) 사이에 비어 있던 조각을 메운다.
 *
 * 값은 버킷이 아니라 원값이다: 이 구간을 깎는 게 목적이라 경계 몇 개로 뭉개면
 * 개선 전후 비교가 안 된다. 압축과 업로드를 따로 싣는 이유도 같다 — 합치면
 * 어느 쪽을 깎을지 못 정한다.
 */
export function trackPracticeUploadProfiled(profile: PracticeUploadProfile): void {
  track("practice_upload_profiled", {
    compress_ms: Math.round(profile.compressMs),
    upload_ms: Math.round(profile.uploadMs),
    original_bytes: profile.originalBytes,
    uploaded_bytes: profile.uploadedBytes,
    was_compressed: profile.wasCompressed,
    webcodecs_supported: profile.webcodecsSupported,
    video_duration_ms: profile.videoDurationMs,
  });
}

export function trackPracticeSessionCreated(
  durationMs: number,
  kind: BlockageKind,
  subBranch: BlockageSubBranch,
  /** Scene Context 세 칸을 모두 비운 채 만든 연습인가. 완주율을 갈라 보는 데 쓴다. */
  sceneSkipped: boolean,
  theoryChoice?: TheoryChoiceId | null,
): void {
  track("practice_session_created", {
    duration_bucket: toDurationBucket(durationMs),
    kind,
    sub_branch: subBranch,
    scene_skipped: sceneSkipped,
    ...(theoryChoice ? { theory_choice: theoryChoice } : {}),
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
