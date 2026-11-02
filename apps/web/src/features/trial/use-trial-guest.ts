"use client";

import { useSyncExternalStore } from "react";
import { isMemberSession, subscribeAuthChange } from "@/lib/auth/token-store";

/**
 * 지금 체험 중인 방문자인가(회원 로그인이 아닌 경우). 서버와 첫 그림은 false 로 두어 체험 띠·안내가
 * 회원에게 잠깐 보였다 사라지는 일이 없게 한다.
 */
export function useTrialGuest(): boolean {
  return useSyncExternalStore(
    subscribeAuthChange,
    () => !isMemberSession(),
    () => false,
  );
}
