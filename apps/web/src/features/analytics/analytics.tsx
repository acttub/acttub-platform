"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isLoggedIn } from "@/lib/auth/token-store";
import { hasAcceptedCurrentPrivacy } from "@/features/auth/pending-consents";
import { grantAnalyticsConsent, startAnalytics, trackPageView } from "@/lib/analytics/ga";

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
    startAnalytics();
    if (isLoggedIn() && hasAcceptedCurrentPrivacy()) grantAnalyticsConsent();
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
