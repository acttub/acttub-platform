export type AnalysisNavigationLock = {
  current: boolean;
};

/**
 * React state가 반영되기 전의 연속 press도 동기 ref 잠금으로 차단한다.
 * 잠금을 얻은 호출만 pending upload를 저장하고 analyzing route로 이동한다.
 */
export function beginAnalysisNavigation(
  lock: AnalysisNavigationLock,
  prepare: () => void,
  navigate: () => void,
): boolean {
  if (lock.current) return false;
  lock.current = true;
  prepare();
  navigate();
  return true;
}
