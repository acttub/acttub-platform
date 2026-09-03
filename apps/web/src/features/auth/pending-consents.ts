import type { ConsentDocument } from "../../lib/api/v2/types";

const PENDING_CONSENTS_KEY = "acttub.pending_consents";
const ACCEPTED_PRIVACY_VERSION_KEY = "acttub.accepted_privacy_version";
const CONSENT_TYPES = new Set(["terms", "privacy", "ai_analysis"]);

/**
 * 이 빌드가 "동의를 받았다"고 인정하는 개인정보처리방침 버전.
 * `apps/api/src/main/resources/consent-docs/manifest.json` 의 privacy 버전과 같아야 한다.
 *
 * ⚠️ **방침을 개정해 새 버전을 발행하면 이 상수도 같이 올린다.** 안 올리면 옛 버전에만
 * 동의한 사람이 새 버전 동의자로 취급돼 계측 쿠키가 그대로 유지된다.
 *
 * 문서는 be가 기동할 때 `manifest.json`을 읽어 자동으로 발행한다(`seed_consent_documents`).
 * deploy.yml의 fe·be 잡은 **나란히 돌아 순서가 정해져 있지 않으므로**, fe가 먼저 뜨면
 * 새 버전이 아직 발행되지 않은 창이 잠깐 생긴다. 그 사이에는 아무도 동의자로 인정되지
 * 않아 계측 쿠키가 꺼지는데, 어차피 버전을 올리는 개정은 전원에게 재동의를 띄우므로
 * 그대로 둔다. 창이 문제가 될 개정이라면 be를 먼저 배포한 뒤 fe를 올린다.
 */
export const EXPECTED_PRIVACY_VERSION = "v4";

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
    // 받을 동의가 남았다는 뜻이므로 동의 기록을 거둔다.
    localStorage()?.removeItem(ACCEPTED_PRIVACY_VERSION_KEY);
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

export function clearAcceptedPrivacyVersion(): void {
  try {
    localStorage()?.removeItem(ACCEPTED_PRIVACY_VERSION_KEY);
  } catch {
    // 저장소를 사용할 수 없으면 이미 동의 기록이 없는 것과 같다.
  }
}

export function hasPendingConsents(): boolean {
  return getPendingConsents().length > 0;
}

/**
 * 이용자가 **어느 버전의** 개인정보처리방침에 동의했는지 남긴다.
 * 동의 화면에서 실제로 그 문서를 제출한 직후에만 부른다.
 *
 * "대기 중인 동의가 비어 있음"으로는 대신할 수 없다. 아래가 전부 비어 있기 때문이다:
 *   ① 로그인한 적 없는 방문자
 *   ② 로그인은 했지만 아직 서버 응답을 못 받은 상태
 *   ③ 새 버전이 발행됐지만 아직 조회하지 않은 상태
 *   ④ 서버에 동의 문서가 아예 발행되지 않아 아무것도 요구하지 않는 상태
 * 버전을 남기면 ③·④가 자연히 걸러진다 — 기록된 버전이 이 빌드가 기대하는 버전과
 * 다르면 동의하지 않은 것으로 본다.
 */
export function markPrivacyVersionAccepted(version: string): void {
  try {
    localStorage()?.setItem(ACCEPTED_PRIVACY_VERSION_KEY, version);
  } catch {
    // 저장소가 없으면 "동의 기록 없음"으로 남는다 — 안전한 쪽이다.
  }
}

/** 이 빌드가 기대하는 버전에 동의한 기록이 있는지. */
export function hasAcceptedCurrentPrivacy(): boolean {
  try {
    return localStorage()?.getItem(ACCEPTED_PRIVACY_VERSION_KEY) === EXPECTED_PRIVACY_VERSION;
  } catch {
    return false;
  }
}
