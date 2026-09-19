import { apiFetch } from "./client";
import type {
  ConsentDocumentsResponse,
  ConsentEntryResponse,
  ConsentEventResponse,
  ConsentRequest,
} from "./types";

// 게스트의 첫 동의에 싣는 "만 14세 이상이에요" 확인(account.guest). api 갈래가 아직 이
// 필드를 내지 않아 생성 타입(v2-schema.d.ts)에 없다 — 통합 작업(I1)이 생성 타입으로 바꾼다.
export type ConsentDecisionRequest = ConsentRequest & { age_confirmed?: true };

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

export async function recordConsent(
  body: ConsentDecisionRequest,
): Promise<ConsentEventResponse> {
  const { data } = await apiFetch<ConsentEventResponse>("/v2/consents", {
    method: "POST",
    body,
    // 시트가 떠 있는 동안 보내는 요청이다. 이것까지 시트를 기다리면 자기 자신을 기다린다.
    consentPrompt: false,
  });
  return data;
}
