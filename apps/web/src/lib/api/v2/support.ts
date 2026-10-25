import { hasGuestSession } from "../../auth/token-store";
import { apiFetch } from "./client";

export type InquiryCategory = "account" | "billing" | "refund" | "usage" | "bug" | "report" | "other";

export type InquiryCreated = { id: string; created_at: string };

/**
 * 고객센터 문의 접수(POST /v2/support/inquiries). 로그인하지 않아도 보낼 수 있다 —
 * 로그인이 안 돼서 문의하는 사람도 있다. 세션이 있으면 토큰을 실어 누가 보냈는지 남기고,
 * 없으면 토큰 없이 보낸다. 문의하려고 게스트를 만들지 않는다.
 */
export async function submitInquiry(
  input: { category: InquiryCategory; email: string; body: string },
  options: { signal?: AbortSignal } = {},
): Promise<InquiryCreated> {
  const signedIn = hasGuestSession();
  const { data } = await apiFetch<InquiryCreated>("/v2/support/inquiries", {
    method: "POST",
    body: input,
    signal: options.signal,
    auth: signedIn,
    startGuest: false,
    consentPrompt: false,
  });
  return data;
}
