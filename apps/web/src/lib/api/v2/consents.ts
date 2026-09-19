import { apiFetch } from "./client";
import type {
  ConsentDocumentsResponse,
  ConsentEntryResponse,
  ConsentEventResponse,
  ConsentNoticesResponse,
  ConsentRequest,
} from "./types";

/** 누구나 읽는 현재 판 전문. 토큰을 싣지 않으므로 게스트를 만들지 않는다. */
export async function listConsentDocuments(
  options: { signal?: AbortSignal } = {},
): Promise<ConsentDocumentsResponse> {
  const { data } = await apiFetch<ConsentDocumentsResponse>(
    "/v2/consents/documents",
    { method: "GET", auth: false, signal: options.signal },
  );
  return data;
}

/**
 * 개인정보 처리방침 같은 고지의 전문. 동의 문서와 달리 결정 대상이 아니고 판·시행일이 없다
 * (결정 I-6). 누구나 읽으므로 토큰을 싣지 않고 게스트를 만들지 않는다.
 */
export async function listConsentNotices(
  options: { signal?: AbortSignal } = {},
): Promise<ConsentNoticesResponse> {
  const { data } = await apiFetch<ConsentNoticesResponse>(
    "/v2/consents/notices",
    { method: "GET", auth: false, signal: options.signal },
  );
  return data;
}

/**
 * 내 동의 현황. 웹에서는 계측 관문(analytics-consent.ts)이 privacy 행의 현재 결정을 읽는 데
 * 쓴다. 조회라서 게스트가 없으면 서버에 가지 않는다 — 부르는 쪽이 게스트 유무를 먼저 본다.
 */
export async function getConsentEntry(
  options: { signal?: AbortSignal } = {},
): Promise<ConsentEntryResponse> {
  const { data } = await apiFetch<ConsentEntryResponse>("/v2/consents/entry", {
    method: "GET",
    signal: options.signal,
    consentPrompt: false,
  });
  return data;
}

/**
 * 문서 하나에 대한 결정. 게스트의 첫 동의에는 "만 14세 이상이에요" 확인(`age_confirmed`)을
 * 함께 싣는다 — 없으면 서버가 422 `age_confirmation_required` 로 거절한다(account.guest).
 */
export async function recordConsent(
  body: ConsentRequest,
): Promise<ConsentEventResponse> {
  const { data } = await apiFetch<ConsentEventResponse>("/v2/consents", {
    method: "POST",
    body,
    // 시트가 떠 있는 동안 보내는 요청이다. 이것까지 시트를 기다리면 자기 자신을 기다린다.
    consentPrompt: false,
  });
  return data;
}
