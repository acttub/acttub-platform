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
 * 대본 목록·리딩 회차·참여작 중 하나라도 못 받았을 때(`recordsFailed`)도 같다(11/2 — 리딩만 해 본 사람이 대본 목록을 못 받아
 * 첫 사용자 홈으로 바뀌었다).
 */
export function firstTimeStateFrom(input: {
  loaded: boolean;
  groupsFailed: boolean;
  /** 대본 목록·리딩 회차·참여작 중 못 받은 것이 있다. */
  recordsFailed?: boolean;
  groups: Parameters<typeof isFirstUser>[0]['groups'];
  scripts: Parameters<typeof isFirstUser>[0]['scripts'];
  practicedDays: number;
  /** 이 기기에서 리딩·코칭을 끝까지 해 본 계정(first-use-graduation). */
  graduated?: boolean;
}): FirstTimeState {
  if (!input.loaded) return 'unknown';
  if (input.graduated) return 'practiced';
  if (!isFirstUser(input)) return 'practiced';
  return input.groupsFailed || input.recordsFailed ? 'unknown' : 'first';
}

/**
 * 첫 사용자를 벗어났다고 이 기기에 남길지(11/2). 홈은 올 때마다 기록을 새로 받아 다시 따지는데, 서버 기록은 바뀐다 —
 * 끝낸 대본을 다시 읽기 시작하면 그 대본은 「연습 중」이 되고, 홈은 최근 14일 안에 읽은 대본의 회차만 받는다.
 * 그래서 기존 사용자 홈을 보던 사람이 리딩을 하고 돌아오면 첫 사용자 홈으로 바뀌었다. 한 번 기록으로 벗어났으면 졸업 표시를
 * 남겨 다시 돌아가지 않게 한다. 이미 표시가 있거나 아직 다 못 받았으면(unknown) 남기지 않는다.
 */
export function shouldRememberGraduation(state: FirstTimeState, graduated: boolean | null): boolean {
  return state === 'practiced' && graduated === false;
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
