"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { onSessionEvent } from "@/lib/auth/session-events";
import {
  createAnalyticsConsentGate,
  type AnalyticsConsentGate,
} from "@/features/consent/analytics-consent";
import {
  clearAnalyticsUser,
  grantAnalyticsConsent,
  revokeAnalyticsConsent,
  setAnalyticsUser,
  startAnalytics,
  trackPageView,
} from "@/lib/analytics/ga";
import {
  setAmplitudeUser,
  startAmplitude,
  stopAmplitude,
  trackScreenViewed,
} from "@/lib/analytics/amplitude";

/**
 * 계측을 켜도 되는지는 서버가 정한다 — 게스트 토큰이 있고 GET /v2/consents/entry 의 privacy
 * 행이 granted 일 때만이다. 조건과 닫힌 쪽으로 실패하는 규칙은 analytics-consent.ts 에 있고,
 * 여기서는 그 관문에 실제 손잡이를 단다.
 *
 * user_id 는 쿠키와 똑같은 조건에서만 붙인다. consent 가 denied 여도 gtag 는 쿠키 없는
 * 히트를 계속 보내므로, 조건 밖에서 설정하면 동의하기 전에 내부 식별자가 구글로 나간다.
 *
 * 끈다는 것은 실제 중단이다. GA4 는 consent 를 denied 로 되돌리고, Amplitude 는 opt-out 으로
 * autocapture 와 세션 리플레이까지 멈춘다.
 */
export const analyticsConsentGate: AnalyticsConsentGate = createAnalyticsConsentGate({
  on(userId) {
    grantAnalyticsConsent();
    // GA4처럼 denied 상태로 먼저 켜지 않는다. 동의 조건을 통과한 뒤에만 init한다.
    startAmplitude();
    setAnalyticsUser(userId);
    setAmplitudeUser(userId);
  },
  off() {
    revokeAnalyticsConsent();
    clearAnalyticsUser();
    stopAmplitude();
  },
});

// 앱을 시작할 때 한 번 묻는다. 화면을 옮길 때마다 묻지 않는다.
let firstCheck: Promise<boolean> | null = null;

/**
 * 루트 레이아웃에 한 번 놓는다. 화면은 그리지 않는다.
 *
 * 서버에 묻는 때는 셋이다 — 앱을 시작할 때 한 번, 탭이 다시 보일 때, 동의 제출 직후(시트가
 * 부른다). 즉시 끄는 때는 403 consent_required 로 시트가 열리는 순간(시트가 부른다)과
 * 게스트가 끝나거나 새로 시작되는 순간이다.
 *
 * 게스트가 없는 방문자, 아직 동의 시트를 만나지 않은 게스트, 옛 판에만 동의한 게스트는
 * 모두 꺼진 채다. 익명 방문자는 consent 가 denied 인 채로 남아 쿠키 없이 집계된다.
 * 동의 전에 생긴 이벤트는 쌓아 두지 않고 버린다.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    startAnalytics();
    firstCheck ??= analyticsConsentGate.check();
    // 첫 답을 기다린 뒤에 쏴야 동의한 게스트의 첫 화면부터 사람에 묶인다. 게스트가 없으면
    // 서버에 묻지 않고 바로 끝난다.
    void firstCheck.then(() => {
      trackPageView(pathname);
      trackScreenViewed(pathname);
    });
  }, [pathname]);

  useEffect(() => {
    // 탭이 가려진 사이 새 판이 나왔을 수 있다. 다시 보일 때 서버에 다시 묻는다.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void analyticsConsentGate.check();
    };
    // 게스트의 끝과 새 게스트의 시작은 화면 전환 없이도 일어난다. 앞 게스트의 켜짐을
    // 물려주지 않는다 — 새 게스트는 동의를 제출한 뒤에야 다시 묻는다.
    const unsubscribe = onSessionEvent(() => analyticsConsentGate.suspend());
    // 다른 탭의 변화는 세션 이벤트로 오지 않는다(token-store 는 storage 로 메모리 캐시만
    // 되돌린다). storage 는 그 탭 밖에서 일어난 변화만 오므로 여기서 같이 듣는다.
    const onStorage = () => void analyticsConsentGate.check();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
