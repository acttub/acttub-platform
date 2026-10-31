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

export type InquiryStatus = "open" | "answered" | "closed";

export type MyInquiry = {
  id: string;
  category: string;
  summary: string;
  status: InquiryStatus | string;
  created_at: string;
};

/**
 * 내 문의 목록(GET /v2/support/inquiries/mine, 최근 20건). 회원만 부른다.
 * 서버가 아직 이 경로를 모르면 404 가 오므로 부르는 쪽이 「목록 없음」으로 다루고 문의하기 링크만 보인다.
 */
export async function fetchMyInquiries(options: { signal?: AbortSignal } = {}): Promise<MyInquiry[]> {
  const { data } = await apiFetch<{ items?: MyInquiry[] }>("/v2/support/inquiries/mine", {
    auth: true,
    startGuest: false,
    consentPrompt: false,
    signal: options.signal,
  });
  return Array.isArray(data?.items) ? data.items : [];
}
