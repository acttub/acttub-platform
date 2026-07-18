import type { ConsentDocument } from "../../lib/api/v2/types";

const PENDING_CONSENTS_KEY = "acttub.pending_consents";
const CONSENT_TYPES = new Set(["terms", "privacy", "ai_analysis"]);

function localStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isConsentDocument(value: unknown): value is ConsentDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === "string" &&
    typeof document.type === "string" &&
    CONSENT_TYPES.has(document.type) &&
    typeof document.version === "string" &&
    typeof document.title === "string" &&
    typeof document.body === "string" &&
    typeof document.required === "boolean" &&
    typeof document.published_at === "string"
  );
}

export function savePendingConsents(consents: ConsentDocument[]): void {
  try {
    localStorage()?.setItem(PENDING_CONSENTS_KEY, JSON.stringify(consents));
  } catch {
    // 저장소를 사용할 수 없는 환경에서는 메모리 밖에 인증 상태를 남기지 않는다.
  }
}

export function getPendingConsents(): ConsentDocument[] {
  try {
    const store = localStorage();
    const value = store?.getItem(PENDING_CONSENTS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every(isConsentDocument)) return parsed;
    store?.removeItem(PENDING_CONSENTS_KEY);
    return [];
  } catch {
    return [];
  }
}

export function clearPendingConsents(): void {
  try {
    localStorage()?.removeItem(PENDING_CONSENTS_KEY);
  } catch {
    // 이미 비어 있는 것과 동일하게 취급한다.
  }
}

export function hasPendingConsents(): boolean {
  return getPendingConsents().length > 0;
}
