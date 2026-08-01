"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isLoggedIn } from "@/lib/auth/token-store";
import { onSessionEvent } from "@/lib/auth/session-events";

/**
 * 로그인했는지만 알려준다. 안 했다고 쫓아내지 않는다.
 *
 * 커뮤니티 읽기처럼 가입 전에도 열려 있어야 하는 화면에서 useRequireAuth 대신 쓴다.
 *
 * useSyncExternalStore 인 이유: 정적 프리렌더에는 localStorage 가 없어 언제나
 * 로그아웃으로 그려진다. effect 에서 setState 로 고치면 렌더가 한 번 더 돌고
 * 린트도 막는다. 서버 스냅샷을 따로 주면 하이드레이션이 어긋나지 않는다.
 */
export function useOptionalAuth(): { loggedIn: boolean } {
  const subscribe = useCallback(
    (notify: () => void) => onSessionEvent(() => notify()),
    [],
  );
  const loggedIn = useSyncExternalStore(
    subscribe,
    () => isLoggedIn(),
    () => false,
  );
  return { loggedIn };
}
