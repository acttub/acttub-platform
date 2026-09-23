/**
 * 가이드를 "어느 화면이 띄웠는지"와 "어디에 그리는지"를 떼어 놓는다 (SOMA-550).
 *
 * <p>처음에는 가이드를 그 화면 안에서 별도 창(Modal)으로 띄웠다. 그랬더니 구멍이 상태바
 * 높이만큼 위로 밀렸다. 비출 자리는 <b>앱 창</b> 기준으로 재는데 그림은 <b>다른 창</b>에
 * 그려서, 두 기준이 어긋난 것이다. 창 밖에서는 그 차이를 알아낼 방법이 없었다.
 *
 * <p>그래서 그림을 앱과 같은 창 안으로 들였다. 화면은 여기에 "이걸 띄워 달라"고 맡기고,
 * 앱 맨 바깥(루트 레이아웃)에 있는 하나뿐인 그리는 쪽이 받아서 화면 위에 덮는다. 기준이
 * 하나라 보정값이 필요 없다.
 */

import { type SpotlightStep } from './guide-spotlight';

export type SpotlightRequest = {
  steps: SpotlightStep[];
  /** 분석에 남길 화면 이름. */
  topic: string;
  onDone: (how: 'skip' | 'done') => void;
};

let current: SpotlightRequest | null = null;
const listeners = new Set<() => void>();

export function showSpotlight(request: SpotlightRequest | null): void {
  if (current === request) return;
  current = request;
  listeners.forEach((fn) => fn());
}

export function currentSpotlight(): SpotlightRequest | null {
  return current;
}

export function onSpotlightChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
