/**
 * 첫 사용자인가 — 「연습 1회」(counted.ts, SOMA-773) 기준 연습한 날이 하나도 없는 사람.
 *
 * 홈이 연습 기록(서버 ∪ 기기에 쌓인 날)을 받을 때마다 여기에 적고, 탭 레이아웃·탭 화면이 읽는다 — 판단은 이 한 곳이다.
 * 첫 사용자로 확인되면 모든 탭에서 탭바를 숨기고(대본·챌린지·프로필 탭은 머리에 홈으로 가는 꺾쇠를 단다), 첫 연습을 하면 다시 보인다.
 *
 * - `unknown`: 홈이 아직 기록을 못 받았다(홈을 거치지 않고 다른 탭으로 바로 들어온 경우 포함). 탭바를 보인다 — 숨길 근거가 없다.
 * - `first`: 연습한 날이 없다. 탭바를 숨긴다.
 * - `practiced`: 연습한 날이 있다. 탭바를 보인다.
 *
 * 홈을 떠나도 지우지 않는다 — 사람에 대한 사실이라 다른 탭에서도 같아야 한다. 홈에 다시 오면 새로 받은 기록으로 고친다.
 */
export type FirstTimeState = 'unknown' | 'first' | 'practiced';

/**
 * 받은 기록으로 정한다. `practicedDays`가 null 이면 기록을 아직 못 받은 것이다.
 * 묶음을 못 받았으면(네트워크 실패 등) 연습한 날이 0이어도 첫 사용자로 보지 않는다 — 연습한 사람의 탭바를 감추는 쪽이 더 이상하다.
 */
export function firstTimeStateFrom(input: { practicedDays: number | null; groupsFailed: boolean }): FirstTimeState {
  if (input.practicedDays === null) return 'unknown';
  if (input.practicedDays > 0) return 'practiced';
  return input.groupsFailed ? 'unknown' : 'first';
}

let state: FirstTimeState = 'unknown';
const listeners = new Set<() => void>();

export function getFirstTimeState(): FirstTimeState {
  return state;
}

export function setFirstTimeState(next: FirstTimeState): void {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeFirstTimeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
