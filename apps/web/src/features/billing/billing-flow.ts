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
      return "결제하려면 앱 계정으로 로그인해 주세요.";
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

/** 내 계정 「구독」 칸에 보일 내용. 서버 /v2/billing/me 그대로를 화면 문장으로만 바꾼다. */
export type SubscriptionView = {
  title: string;
  /** 어디서 결제했는지(제목 옆 표시). 모르면 null. */
  badge: string | null;
  /** 금액·다음 결제일 한 줄. 모르면 null. */
  summary: string | null;
  lines: string[];
  /** 웹(토스) 구독을 여기서 해지할 수 있는가 */
  cancelable: boolean;
  /** 요금 안내·구독 시작으로 보낼 링크를 보일까 */
  showPricing: boolean;
};

type MeLike = {
  status: string;
  pro: boolean;
  amount: number;
  period_end: string | null;
  next_billing_at: string | null;
  card_company: string | null;
  card_last4: string | null;
  provider?: string | null;
  grant_ends_at?: string | null;
};

/** ISO 시각을 한국 날짜로. 읽지 못하면 null. */
export function koreanDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(date);
  return parts;
}

function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export function subscriptionViewOf(me: MeLike): SubscriptionView {
  const until = koreanDate(me.period_end);
  const next = koreanDate(me.next_billing_at);
  if (me.provider === "apple" || me.provider === "google") {
    const store = me.provider === "apple" ? "App Store" : "Google Play";
    const where = me.provider === "apple" ? "아이폰 설정 › Apple 계정 › 구독" : "Google Play 앱 › 프로필 › 결제 및 정기 결제 › 정기 결제";
    return {
      title: "Pro",
      badge: `${store}에서 결제`,
      summary: [`월 ${won(me.amount)}`, next ? `다음 결제일 ${next}` : null].filter((l): l is string => !!l).join(" · "),
      lines: [`${store}에서 결제한 구독은 ${store}의 구독 관리(${where})에서 바꾸거나 해지할 수 있어요.`],
      cancelable: false,
      showPricing: false,
    };
  }
  if (me.provider === "toss") {
    const card = me.card_last4 ? `${me.card_company ?? "카드"} 끝자리 ${me.card_last4}` : null;
    switch (me.status) {
      case "active":
        return {
          title: "Pro 이용 중",
          badge: "웹에서 결제",
          summary: null,
          lines: [`월 ${won(me.amount)} 자동결제`, next ? `다음 결제일 ${next}` : null, card].filter((l): l is string => !!l),
          cancelable: true,
          showPricing: false,
        };
      case "canceled":
        return {
          title: "해지 예정",
          badge: "웹에서 결제",
          summary: null,
          lines: [until ? `${until}까지 Pro를 쓰고, 그 뒤로는 결제되지 않아요.` : "다음 자동결제는 되지 않아요."],
          cancelable: false,
          showPricing: false,
        };
      case "past_due":
        return {
          title: "결제가 안 됐어요",
          badge: "웹에서 결제",
          summary: null,
          lines: [
            "카드 한도나 유효기간을 확인해 주세요. 정해진 날짜에 다시 결제를 시도해요.",
            until ? `${until}까지는 Pro를 그대로 써요.` : null,
          ].filter((l): l is string => !!l),
          cancelable: true,
          showPricing: false,
        };
      case "expired":
        return { title: "구독이 끝났어요", badge: "웹에서 결제", summary: null, lines: ["다시 구독하면 바로 Pro를 쓸 수 있어요."], cancelable: false, showPricing: true };
    }
  }
  const grant = koreanDate(me.grant_ends_at);
  if (me.pro && grant) {
    return { title: "Pro 무료 이용 중", badge: null, summary: null, lines: [`${grant}까지 Pro를 무료로 써요. 카드는 등록되지 않아요.`], cancelable: false, showPricing: true };
  }
  return { title: "무료로 쓰고 있어요", badge: null, summary: null, lines: [`Pro는 월 ${won(me.amount)}예요.`], cancelable: false, showPricing: true };
}

/** 해지 결과 문장. */
export function cancelDoneMessage(me: MeLike): string {
  const until = koreanDate(me.period_end);
  return until ? `해지했어요. ${until}까지 Pro를 쓸 수 있어요.` : "해지했어요. 다음 자동결제는 되지 않아요.";
}
