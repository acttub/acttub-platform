import { isFirstUser } from '../home-today.ts';

/**
 * 첫 사용자인가 — 홈 「뭐부터 해 볼까요?」(bHxn1I)와 같은 기준(lib/home-today isFirstUser): 연습 1회를 아직 끝내지 않은 사람.
 * 시작만 하고 나간 것(노트 전 코칭·넣기만 한 대본)은 세지 않는다(SOMA-827, 옛 기준은 SOMA-781 「무엇이든 시작」).
 *
 * 홈이 연습 기록(서버 ∪ 기기에 쌓인 날)을 받을 때마다 여기에 적고, 탭 레이아웃·탭 화면이 읽는다 — 판단은 이 한 곳이다.
 * 첫 사용자로 확인되면 모든 탭에서 탭바를 숨기고(대본·챌린지·프로필 탭은 머리에 홈으로 가는 꺾쇠를 단다), 첫 연습을 하면 다시 보인다.
 *
 * - `unknown`: 홈이 아직 기록을 못 받았다(홈을 거치지 않고 다른 탭으로 바로 들어온 경우 포함). 탭바를 보인다 — 숨길 근거가 없다.
 * - `first`: 아무것도 시작하지 않았다. 탭바를 숨긴다(코칭·대본 첫 화면에는 설정 버튼을 둔다 — 로그아웃·탈퇴 길).
 * - `practiced`: 무엇이든 시작했다. 탭바를 보인다.
 *
 * 홈을 떠나도 지우지 않는다 — 사람에 대한 사실이라 다른 탭에서도 같아야 한다. 홈에 다시 오면 새로 받은 기록으로 고친다.
 */
export type FirstTimeState = 'unknown' | 'first' | 'practiced';

/**
 * 홈이 받은 기록으로 정한다. `loaded`가 false 면(묶음·대본·연습한 날 중 아직 못 받은 게 있으면) 모른다.
 * 묶음을 못 받았으면(네트워크 실패 등) 나머지가 다 0이어도 첫 사용자로 보지 않는다 — 시작한 사람의 탭바를 감추는 쪽이 더 이상하다.
 */
export function firstTimeStateFrom(input: {
  loaded: boolean;
  groupsFailed: boolean;
  groups: Parameters<typeof isFirstUser>[0]['groups'];
  scripts: Parameters<typeof isFirstUser>[0]['scripts'];
  practicedDays: number;
}): FirstTimeState {
  if (!input.loaded) return 'unknown';
  if (!isFirstUser(input)) return 'practiced';
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
