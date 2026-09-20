"use client";

import { useCallback, useSyncExternalStore } from "react";

import { onSessionEvent } from "@/lib/auth/session-events";
import { REFRESH_KEY, hasGuestSession } from "@/lib/auth/token-store";

/**
 * 이 브라우저에 게스트가 있는지만 알려 준다. 없다고 만들지 않는다 — 게스트는 배우가 처음
 * 보호 기능을 쓰려 할 때 공용 클라이언트가 만든다(account.guest).
 *
 * 화면은 이것으로 조회를 가린다. 게스트가 없으면 볼 자료도 없으므로 서버에 묻지 않고
 * 빈 상태를 그린다. 화면을 여는 것만으로 계정이 생기면 안 된다.
 *
 * useSyncExternalStore 인 이유: 정적 프리렌더에는 localStorage 가 없어 언제나 게스트
 * 없음으로 그려진다. effect 에서 setState 로 고치면 렌더가 한 번 더 돌고 린트도 막는다.
 * 서버 스냅샷을 따로 주면 하이드레이션이 어긋나지 않는다.
 */
export function useGuestSession(): { hasSession: boolean } {
  const subscribe = useCallback((notify: () => void) => {
    const unsubscribe = onSessionEvent(() => notify());
    // 다른 탭에서 게스트가 시작되거나 끝난 것은 세션 이벤트로 오지 않는다.
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === REFRESH_KEY) notify();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const hasSession = useSyncExternalStore(
    subscribe,
    () => hasGuestSession(),
    () => false,
  );
  return { hasSession };
}
