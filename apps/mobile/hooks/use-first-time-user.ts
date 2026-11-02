import { useSyncExternalStore } from 'react';

import { getFirstTimeState, getFirstTimeTabBarHidden, subscribeFirstTimeState } from '@/lib/practice/first-time';

/** 첫 사용자로 확인됐는가 — 그동안 탭바가 숨는다(lib/practice/first-time). 아직 모르면 false. */
export function useFirstTimeUser(): boolean {
  return useSyncExternalStore(subscribeFirstTimeState, getFirstTimeState) === 'first';
}

/** 탭바를 숨기는가 — useFirstTimeUser 에 더해, 홈이 첫 사용자 뼈대를 그리는 동안에도 숨긴다(lib/practice/first-time). 탭바 모양에만 쓴다. */
export function useFirstTimeTabBarHidden(): boolean {
  return useSyncExternalStore(subscribeFirstTimeState, getFirstTimeTabBarHidden);
}
