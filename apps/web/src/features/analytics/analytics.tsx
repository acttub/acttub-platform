"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getStoredUser, isLoggedIn } from "@/lib/auth/token-store";
import { onSessionEvent } from "@/lib/auth/session-events";
import { hasAcceptedCurrentPrivacy } from "@/features/auth/pending-consents";
import { captureSignupAttribution } from "@/features/auth/signup-attribution";
import {
  clearAnalyticsUser,
  grantAnalyticsConsent,
  setAnalyticsUser,
  startAnalytics,
  trackPageView,
} from "@/lib/analytics/ga";
import {
  resetAmplitudeUser,
  setAmplitudeUser,
  startAmplitude,
  trackScreenViewed,
} from "@/lib/analytics/amplitude";

/**
 * user_id 는 쿠키와 똑같은 조건에서만 붙인다. consent 가 denied 여도 gtag 는 쿠키 없는
 * 히트를 계속 보내므로, 조건 밖에서 설정하면 방침에 동의하기 전에 내부 식별자가 구글로
 * 나간다(방침 v2 6항의 수집 항목에 없는 값이다).
 */
function syncAnalyticsUser(): void {
  if (isLoggedIn() && hasAcceptedCurrentPrivacy()) {
    const storedUser = getStoredUser();
    if (storedUser) {
      // 로그인 이벤트는 화면 이동보다 먼저 온다. 여기서도 켜야 돌아온 사용자의 로그인
      // 완료 이벤트가 다음 pathname을 기다리다 유실되지 않는다.
      startAmplitude();
      setAnalyticsUser(storedUser.id);
      setAmplitudeUser(storedUser.id);
      return;
    }
  }
  clearAnalyticsUser();
  resetAmplitudeUser();
}

/**
 * 루트 레이아웃에 한 번 놓는다. 화면은 그리지 않는다.
 *
 * 쿠키를 켜도 되는지는 **로그인 + 이 빌드가 기대하는 버전의 방침에 동의한 기록**으로 본다.
 * "대기 중인 동의가 비어 있다"만 보면 안 된다 — 그 상태에는 동의한 적 없는 방문자,
 * 새 버전 발행 직후 아직 조회하지 않은 옛 동의자, 서버에 문서가 발행되지 않은 경우가
 * 전부 섞여 있다(pending-consents.ts 참고).
 * 익명 방문자는 consent 가 denied 인 채로 남아 쿠키 없이 집계된다(방침 v2 6항).
 *
 * 동의 화면(terms-gate)이 끝나면 화면이 바뀌므로, pathname 이 바뀔 때마다 다시 본다 —
 * 이 시점이면 충분해서 따로 이벤트를 깔지 않는다.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    // 가입 유입은 동의·로그인 전 첫 진입에서 잡아야 한다. GA 전송 게이트와 무관한 로컬 기록이다.
    captureSignupAttribution();
    startAnalytics();
    if (isLoggedIn() && hasAcceptedCurrentPrivacy()) {
      grantAnalyticsConsent();
      // GA4처럼 denied 상태로 먼저 켜지 않는다. 동의 조건을 통과한 뒤에만 init한다.
      startAmplitude();
    }
    // page_view 보다 먼저 붙여야 동의 직후 첫 화면부터 사람에 묶인다.
    syncAnalyticsUser();
    trackPageView(pathname);
    trackScreenViewed(pathname);
  }, [pathname]);

  // 로그아웃과 재동의 요구는 화면 전환 없이도 일어난다 — 같은 탭에서 로그아웃 버튼을
  // 누르거나, 다른 탭에서 로그아웃해 이 탭의 토큰이 사라지거나, 방침이 개정되거나.
  // 위 effect 는 pathname 이 바뀔 때만 도는데 그때까지 이전 user_id 가 남아 있으면
  // 그 사이의 히트가 이미 나간 사람에게 계속 붙는다.
  useEffect(() => {
    const unsubscribe = onSessionEvent(syncAnalyticsUser);
    // 다른 탭의 변화는 세션 이벤트로 오지 않는다(token-store 는 storage 로 메모리 캐시만
    // 되돌린다). storage 는 그 탭 밖에서 일어난 변화만 오므로 여기서 같이 듣는다.
    window.addEventListener("storage", syncAnalyticsUser);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", syncAnalyticsUser);
    };
  }, []);

  return null;
}
