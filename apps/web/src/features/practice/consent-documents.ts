import {
  listConsentDocuments,
} from "@/lib/api/v2/consents";
import type {
  ConsentEntryDocument,
  ConsentEntryResponse,
} from "@/lib/api/v2/types";
import { isLoggedIn } from "@/lib/auth/token-store";
import {
  asUndecidedConsentEntryDocuments,
  readConsentEntryOnce,
} from "@/features/auth/consent-entry";

export type ConsentDocuments = {
  mode: "decision_required" | "blocked" | "info";
  documents: ConsentEntryDocument[];
};

export function consentDocumentsFromEntry(
  entry: ConsentEntryResponse,
): ConsentDocuments {
  if (entry.entry_status === "decision_required") {
    return {
      mode: "decision_required",
      documents: entry.undecided_documents,
    };
  }
  if (entry.entry_status === "blocked") {
    return { mode: "blocked", documents: entry.documents };
  }
  return { mode: "info", documents: entry.documents };
}

/** 로그인 상태에서는 기기 캐시가 아니라 서버의 진입 결과를 정본으로 사용한다. */
export async function loadConsentDocuments(
  signal?: AbortSignal,
): Promise<ConsentDocuments> {
  if (isLoggedIn()) {
    const entry = await readConsentEntryOnce();
    const surface = consentDocumentsFromEntry(entry);
    if (surface.mode !== "info" || surface.documents.length > 0) return surface;
  }

  const response = await listConsentDocuments({ signal });
  return {
    mode: "info",
    documents: asUndecidedConsentEntryDocuments(response.documents),
  };
}
