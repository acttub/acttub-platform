import {
  getConsentEntry,
  getPendingConsents,
} from "@/lib/api/v2/consents";
import { ApiError } from "@/lib/api/v2/errors";
import type {
  ConsentDocument,
  ConsentEntryDocument,
  ConsentEntryResponse,
} from "@/lib/api/v2/types";
import { getRefreshToken } from "@/lib/auth/token-store";
import {
  clearAcceptedPrivacyVersion,
  clearPendingConsents,
  savePendingConsents,
} from "./pending-consents";

type CachedConsentEntry = {
  refreshToken: string;
  response: Promise<ConsentEntryResponse>;
};

let cachedEntry: CachedConsentEntry | null = null;

/** 로그아웃이나 테스트 격리처럼 현재 인증 세션의 진입 결과를 버려야 할 때 사용한다. */
export function clearConsentEntrySession(): void {
  cachedEntry = null;
}

export function asUndecidedConsentEntryDocuments(
  documents: ConsentDocument[],
): ConsentEntryDocument[] {
  return documents.map((document) => ({
    ...document,
    current_decision: null,
  }));
}

async function loadConsentEntry(
  fallbackDocuments?: ConsentDocument[],
): Promise<ConsentEntryResponse> {
  try {
    return await getConsentEntry();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;

    const pending = asUndecidedConsentEntryDocuments(
      fallbackDocuments ?? (await getPendingConsents()).documents,
    );
    return {
      entry_status: pending.length > 0 ? "decision_required" : "allowed",
      documents: pending,
      undecided_documents: pending,
    };
  }
}

/**
 * 로그인 직후와 저장 세션 복원 경로가 같은 진입 결과를 공유한다. 네트워크 실패는 캐시하지
 * 않아 화면의 재시도가 실제로 서버를 다시 읽게 한다.
 */
export function readConsentEntryOnce(
  options: { fallbackDocuments?: ConsentDocument[] } = {},
): Promise<ConsentEntryResponse> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error("로그인이 필요합니다."));
  }
  if (cachedEntry?.refreshToken === refreshToken) return cachedEntry.response;

  return loadAndCacheConsentEntry(refreshToken, options.fallbackDocuments);
}

function loadAndCacheConsentEntry(
  refreshToken: string,
  fallbackDocuments?: ConsentDocument[],
): Promise<ConsentEntryResponse> {
  const response = loadConsentEntry(fallbackDocuments).catch((error: unknown) => {
    if (cachedEntry?.response === response) cachedEntry = null;
    throw error;
  });
  cachedEntry = { refreshToken, response };
  return response;
}

/** 저장 뒤 최종 확인과 사용자의 명시적 재시도는 캐시를 건너뛰고 최신 결과를 읽는다. */
export function refreshConsentEntry(
  options: { fallbackDocuments?: ConsentDocument[] } = {},
): Promise<ConsentEntryResponse> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error("로그인이 필요합니다."));
  }
  return loadAndCacheConsentEntry(refreshToken, options.fallbackDocuments);
}

export type ConsentEntryResolution =
  | {
      kind: "allowed";
      entry: ConsentEntryResponse;
    }
  | {
      kind: "decision_required" | "blocked";
      destination: string;
      entry: ConsentEntryResponse;
    };

function withoutCurrentDecision(
  documents: ConsentEntryDocument[],
): ConsentDocument[] {
  return documents.map((document) => ({
    id: document.id,
    type: document.type,
    version: document.version,
    title: document.title,
    body: document.body,
    required: document.required,
    published_at: document.published_at,
  }));
}

/** 서버의 진입 결과를 화면 이동으로 번역하는 새 로그인·저장 세션 공용 seam. */
export async function resolveConsentEntry(
  nextPath: string,
  options: { fallbackDocuments?: ConsentDocument[] } = {},
): Promise<ConsentEntryResolution> {
  const entry = await readConsentEntryOnce(options);
  const currentPrivacy = entry.documents.find(
    (document) => document.type === "privacy",
  );
  if (currentPrivacy?.current_decision !== "granted") {
    clearAcceptedPrivacyVersion();
  }

  if (entry.entry_status === "decision_required") {
    savePendingConsents(withoutCurrentDecision(entry.undecided_documents));
    return {
      kind: "decision_required",
      destination: `/terms?next=${encodeURIComponent(nextPath)}`,
      entry,
    };
  }

  clearPendingConsents();
  if (entry.entry_status === "blocked") {
    return { kind: "blocked", destination: "/terms", entry };
  }
  return { kind: "allowed", entry };
}
