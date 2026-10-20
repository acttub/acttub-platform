import { useSyncExternalStore } from 'react';

import { getFirstTimeState, subscribeFirstTimeState } from '@/lib/practice/first-time';

/** 첫 사용자로 확인됐는가 — 그동안 탭바가 숨는다(lib/practice/first-time). 아직 모르면 false. */
export function useFirstTimeUser(): boolean {
  return useSyncExternalStore(subscribeFirstTimeState, getFirstTimeState) === 'first';
}
