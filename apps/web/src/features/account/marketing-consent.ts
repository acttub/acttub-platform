// 선택 동의 「혜택·이벤트 소식」을 내 계정에서 바꾼다(SOMA-834). 기존 동의 API만 쓴다:
// 현재 결정은 GET /v2/consents/entry 의 documents[].current_decision, 바꾸기는 POST /v2/consents(문서마다 granted·declined).
import { getConsentEntry, recordConsent } from "@/lib/api/v2/consents";

import { MARKETING_TYPES } from "./account-format";

export type MarketingState = { documentIds: string[]; on: boolean } | null;

/** 마케팅 문서가 없으면 null(토글을 그리지 않는다). 모든 마케팅 문서가 granted 일 때만 켜진 것으로 본다. */
export async function loadMarketing(signal?: AbortSignal): Promise<MarketingState> {
  const entry = await getConsentEntry({ signal });
  const docs = entry.documents.filter((d) => MARKETING_TYPES.includes(d.type));
  if (docs.length === 0) return null;
  return { documentIds: docs.map((d) => d.id), on: docs.every((d) => d.current_decision === "granted") };
}

export async function saveMarketing(documentIds: readonly string[], on: boolean): Promise<void> {
  for (const id of documentIds) {
    await recordConsent({ document_id: id, action: on ? "granted" : "declined" });
  }
}
