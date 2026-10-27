import { apiFetch } from "./client";

// ACTTUB Pro 웹 정기결제 (SOMA-818). 계약은 /v2/billing/* (docs/specs/billing/subscription.md).
//
// 카드 번호·authKey·빌링키는 이 모듈이 만지지 않는다. 서버가 일회용 카드 등록 창 주소를 주고, 브라우저는 그 주소로
// 이동할 뿐이다. 카드 등록은 토스 화면에서 하고, 토스가 서버 콜백으로 보낸 뒤 서버가 첫 결제를 한다.
// ⚠ 심사용 /v2/pg-review 와 다른 API 다 — 회원 토큰(Authorization)으로 부르고 pg-review 쿠키 세션과 섞이지 않는다.

export type BillingStatus = "none" | "active" | "canceled" | "past_due" | "expired";

export type BillingMe = {
  status: BillingStatus;
  pro: boolean;
  amount: number;
  period_end: string | null;
  next_billing_at: string | null;
  card_company: string | null;
  card_last4: string | null;
  provider?: "toss" | "apple" | "google" | null;
  grant_ends_at?: string | null;
};

export type BillingCheckout = { checkout_url: string; return_url: string; expires_at: string };

/** 구독 상태. 게스트도 읽을 수 있고, 결제 기능이 닫혀 있으면 404 billing_unavailable 이다. */
export async function fetchBillingMe(options: { signal?: AbortSignal } = {}): Promise<BillingMe> {
  const { data } = await apiFetch<BillingMe>("/v2/billing/me", {
    auth: true,
    startGuest: false,
    signal: options.signal,
  });
  return data;
}

/** 일회용 카드 등록 창 주소를 받는다. 게스트는 403 billing_member_required 다. */
export async function startBillingCheckout(options: { signal?: AbortSignal } = {}): Promise<BillingCheckout> {
  const { data } = await apiFetch<BillingCheckout>("/v2/billing/checkout", {
    method: "POST",
    body: { purpose: "subscribe" },
    auth: true,
    startGuest: false,
    consentPrompt: false,
    signal: options.signal,
  });
  return data;
}
