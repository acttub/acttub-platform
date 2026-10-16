import type { PgReviewCheckout, PgReviewResult } from "@/lib/api/v2/pg-review";

// PG 심사 전용 테스트 결제(SOMA-620)의 순수 규칙. 화면과 분리해 두어 node test 로 잰다.

export const TEST_CLIENT_KEY = /^test_ck_[A-Za-z0-9_-]+$/;

export const PG_REVIEW_SUCCESS_PATH = "/v2/pg-review/success";
export const PG_REVIEW_FAIL_PATH = "/v2/pg-review/fail";

export const TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";

export function isTestClientKey(value: string): boolean {
  return TEST_CLIENT_KEY.test(value);
}

function sameOriginPath(raw: string, origin: string, expectedPath: string): boolean {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return false;
  }
  return (
    url.origin === origin &&
    url.pathname === expectedPath &&
    url.searchParams.has("state") &&
    url.hash === ""
  );
}

/**
 * 서버가 준 체크아웃 값을 SDK 에 넘기기 전에 거른다. 실패하면 이유 코드를, 통과하면 null.
 * 키가 test_ck_ 가 아니면 SDK 를 부르지 않는다(실결제 방어는 서버가 먼저 하고, 여기는 두 번째 막이다).
 */
export function checkoutProblem(checkout: PgReviewCheckout, origin: string): string | null {
  if (!isTestClientKey(checkout.clientKey)) return "live_or_invalid_client_key";
  if (!checkout.customerKey || checkout.customerKey.length > 300) return "invalid_customer_key";
  if (!sameOriginPath(checkout.successUrl, origin, PG_REVIEW_SUCCESS_PATH)) return "invalid_success_url";
  if (!sameOriginPath(checkout.failUrl, origin, PG_REVIEW_FAIL_PATH)) return "invalid_fail_url";
  return null;
}

export const CHECKOUT_PROBLEM_MESSAGE =
  "결제 준비 값이 올바르지 않아 중단했어요. 잠시 뒤 처음부터 다시 시도해 주세요.";

export type ResultTone = "success" | "danger" | "pending" | "neutral";

export type ResultView = {
  tone: ResultTone;
  title: string;
  body: string;
  /** 결과가 아직 바뀔 수 있어 다시 읽어야 하는가 */
  polling: boolean;
  /** 같은 화면에서 새로 시작해도 되는가. unknown 에서는 새 주문을 만들지 않는다. */
  canRetry: boolean;
};

/** 서버가 준 결과를 화면 문구로 옮긴다. 결과는 서버 값만 믿고, 이 함수가 상태를 만들어 내지 않는다. */
export function describeResult(result: PgReviewResult): ResultView {
  switch (result.status) {
    case "approved":
      return {
        tone: "success",
        title: "테스트 결제가 승인됐어요",
        body: "심사용 테스트 승인이 확인됐어요. 실제 구독 권한은 주어지지 않았고, 자동 갱신 결제도 없어요.",
        polling: false,
        canRetry: false,
      };
    case "processing":
      return {
        tone: "pending",
        title: "결제를 확인하고 있어요",
        body: "서버가 결과를 확인하는 중이에요. 이 창을 닫지 말고 잠시 기다려 주세요.",
        polling: true,
        canRetry: false,
      };
    case "failed":
      return {
        tone: "danger",
        title: "테스트 결제가 완료되지 않았어요",
        body: (result.message && /[가-힣]/.test(result.message) ? result.message : "") || "카드 등록이나 승인이 끝나지 않았어요. 승인된 결제는 없어요. 다시 시도할 수 있어요.",
        polling: false,
        canRetry: true,
      };
    case "unknown":
      return {
        tone: "pending",
        title: "결과를 아직 알 수 없어요",
        body: "승인 응답을 받지 못했어요. 같은 주문의 결과를 서버가 확인할 때까지 새로 결제하지 말고, 잠시 뒤 이 화면을 새로 열어 확인해 주세요.",
        polling: false,
        canRetry: false,
      };
    default:
      return {
        tone: "neutral",
        title: "진행 중인 테스트 결제가 없어요",
        body: "아직 시작한 테스트 결제가 없거나 이전 결과가 지워졌어요.",
        polling: false,
        canRetry: true,
      };
  }
}

/** 토스 SDK 가 사용자가 창을 닫았을 때 던지는 코드. 오류로 보이지 않고 조용히 되돌린다. */
export function isUserCancel(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "USER_CANCEL"
  );
}
