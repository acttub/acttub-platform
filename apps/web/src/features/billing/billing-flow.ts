// ACTTUB Pro 웹 결제의 순수 규칙 (SOMA-818). 화면 없이 테스트한다.

/** 웹 결제를 연 빌드인가. 꺼져 있으면 /pricing 은 심사용 흐름(/pg-review) 그대로다. */
export const WEB_BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_WEB_ENABLED === "true";

export type StartOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "login_required" }
  | { kind: "unavailable" }
  | { kind: "already_subscribed" }
  | { kind: "payment_pending" }
  | { kind: "error" };

type ErrorLike = { status?: number; code?: string; message?: string };

/** 서버 오류를 사용자에게 보일 상태로 가른다. */
export function startOutcomeOf(error: unknown): StartOutcome {
  const e = (error ?? {}) as ErrorLike;
  const code = e.code ?? e.message ?? "";
  if (e.status === 401 || code === "billing_member_required") return { kind: "login_required" };
  if (e.status === 404 || code === "billing_unavailable") return { kind: "unavailable" };
  if (code === "already_subscribed") return { kind: "already_subscribed" };
  if (code === "payment_pending") return { kind: "payment_pending" };
  return { kind: "error" };
}

/** 서버가 준 카드 등록 창 주소만 따라간다 — https 이거나 개발용 루프백만. */
export function safeCheckoutUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback)) return parsed.toString();
  } catch {
    return null;
  }
  return null;
}

export type ReturnStatus = "done" | "failed" | "unknown" | "canceled" | "invalid";

/** 결제 뒤 돌아온 주소의 status. 모르는 값이면 null. 결제 성립은 서버 /v2/billing/me 가 정한다. */
export function returnStatusOf(search: string): ReturnStatus | null {
  const value = new URLSearchParams(search).get("status");
  return value === "done" || value === "failed" || value === "unknown" || value === "canceled" || value === "invalid"
    ? value
    : null;
}

export type ResultView = { title: string; body: string; tone: "ok" | "wait" | "fail" };

export function resultViewOf(status: ReturnStatus | null, pro: boolean): ResultView {
  if (pro) {
    return { title: "ACTTUB Pro 결제가 완료됐어요", body: "코칭과 대본 보관에 제한 없이 Pro를 이용해요.", tone: "ok" };
  }
  switch (status) {
    case "unknown":
      return {
        title: "결제 결과를 확인하고 있어요",
        body: "토스페이먼츠에서 결과를 받는 중이에요. 두 번 결제되지 않으니 잠시 뒤 이 화면을 새로 열어 주세요.",
        tone: "wait",
      };
    case "canceled":
      return { title: "결제를 취소했어요", body: "카드는 등록되지 않았고 결제도 되지 않았어요.", tone: "fail" };
    case "done":
      return { title: "결제 결과를 확인하고 있어요", body: "잠시 뒤 이 화면을 새로 열어 주세요.", tone: "wait" };
    default:
      return {
        title: "결제하지 못했어요",
        body: "카드 한도나 정보를 확인한 뒤 다시 시도해 주세요. 다시 시도해도 두 번 결제되지 않아요.",
        tone: "fail",
      };
  }
}

/** 시작 오류 문구. */
export function startMessage(outcome: StartOutcome): string | null {
  switch (outcome.kind) {
    case "login_required":
      return "결제하려면 ACTTUB 회원 로그인이 필요해요. 웹 로그인은 준비 중이에요.";
    case "unavailable":
      return "결제를 준비하고 있어요. 시작하면 따로 안내해요.";
    case "already_subscribed":
      return "이미 Pro를 이용하고 있어요.";
    case "payment_pending":
      return "앞선 결제의 결과를 확인하고 있어요. 잠시 뒤 다시 시도해 주세요.";
    case "error":
      return "결제 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.";
    default:
      return null;
  }
}
