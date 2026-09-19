import { getConsentEntry } from "@/lib/api/v2/consents";
import { onSessionEvent } from "@/lib/auth/session-events";
import {
  REFRESH_KEY,
  getStoredUser,
  hasGuestSession,
} from "@/lib/auth/token-store";

// 계측(GA4 쿠키·Amplitude)을 켜도 되는지를 가리는 관문(SOMA-528 결정 I-6).
//
// **단일 기준은 서버다.** 이 브라우저에 게스트 토큰이 있고, GET /v2/consents/entry 의
// privacy 종류 행이 `current_decision === "granted"` 일 때만 켠다. entry 는 현재 판에 대한
// 결정을 주므로 새 판이 나오면 그 행이 미결정으로 돌아가 저절로 꺼진다 — 옛 판에만 동의한
// 사람에게 새 판의 수집을 적용하지 않는다. 판 번호를 빌드에 박아 두지도, 계측 판단을
// localStorage 에 복제해 두지도 않는다.
//
// 토큰이 없거나(랜딩만 본 방문자), 행이 없거나, 값이 다르거나, 조회가 실패하면 끈다.
// 조회 중에도 꺼진 상태다.

/** 계측을 실제로 켜고 끄는 손잡이. 끈다는 것은 식별자만 지우는 게 아니라 수집의 중단이다. */
export type MeasurementSwitch = {
  on: (userId: string) => void;
  off: () => void;
};

export type AnalyticsConsentGate = {
  /**
   * 서버에 물어 그 답대로 켜거나 끈다. 앱을 시작할 때 한 번, 탭이 다시 보일 때, 동의 제출
   * 직후에 부른다.
   */
  check: () => Promise<boolean>;
  /**
   * 묻지 않고 즉시 끈다. 어떤 요청이든 403 consent_required 를 받아 시트가 열리는 순간,
   * 게스트가 끝나거나 새로 시작되는 순간에 부른다. 진행 중이던 조회의 답은 버린다.
   */
  suspend: () => void;
};

export function isPrivacyGranted(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false;
  const { documents } = entry as { documents?: unknown };
  if (!Array.isArray(documents)) return false;
  return documents.some(
    (document: { type?: unknown; current_decision?: unknown } | null) =>
      document?.type === "privacy" && document.current_decision === "granted",
  );
}

export function createAnalyticsConsentGate(
  measurement: MeasurementSwitch,
): AnalyticsConsentGate {
  // 늦게 온 답이 그 사이의 끄기(suspend)나 더 새로운 조회를 덮지 못하게 한다.
  let generation = 0;

  return {
    async check() {
      generation += 1;
      const asked = generation;
      measurement.off();
      // 게스트가 없으면 묻지 않는다 — 이 조회 때문에 게스트가 생기는 일도 없다.
      if (!hasGuestSession()) return false;

      let granted: boolean;
      try {
        granted = isPrivacyGranted(await getConsentEntry());
      } catch {
        granted = false;
      }
      if (asked !== generation) return false;

      const userId = hasGuestSession() ? (getStoredUser()?.id ?? null) : null;
      if (!granted || userId === null) return false;
      measurement.on(userId);
      return true;
    },
    suspend() {
      generation += 1;
      measurement.off();
    },
  };
}

/**
 * 다른 탭의 storage 이벤트가 게스트의 끝이나 시작인가. 게스트 토큰 키만 본다 — 다른 키는
 * 계측 조건과 무관한데 다른 탭의 SDK 가 이벤트마다 쓴다. 값이 값으로 바뀐 것은 같은 게스트의
 * 토큰 회전이라 끝도 시작도 아니다(게스트가 바뀔 때는 언제나 앞 토큰을 지운 뒤에 새 토큰을
 * 쓴다 — endGuestSession → ensureGuestSession). key 가 없으면 저장소가 통째로 비워진 것이다.
 */
function isGuestBoundary(event: StorageEvent): boolean {
  if (event.key === null) return true;
  if (event.key !== REFRESH_KEY) return false;
  return event.oldValue === null || event.newValue === null;
}

/**
 * 게스트의 끝(갱신 거절·닫힌 계정·앱으로 옮겨짐)과 새 게스트의 시작은 화면 전환 없이도
 * 일어난다. 그 순간 묻지 않고 끈다 — 앞 게스트의 켜짐을 물려주지 않는다. 새 게스트는 동의를
 * 제출한 뒤에야 다시 묻는다. 돌려주는 함수로 거둔다.
 *
 * 다른 탭에서 일어난 끝·시작은 세션 이벤트로 오지 않는다(token-store 는 storage 로 메모리
 * 캐시만 되돌린다). storage 는 그 탭 밖에서 일어난 변화만 오므로 여기서 같이 듣고 같게
 * 다룬다 — 서버에 묻는 때가 아니다. 이 탭은 다시 보일 때 묻는다.
 */
export function watchGuestSession(gate: AnalyticsConsentGate): () => void {
  const unsubscribe = onSessionEvent(() => gate.suspend());
  const onStorage = (event: StorageEvent) => {
    if (isGuestBoundary(event)) gate.suspend();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}
