import { Easing } from 'react-native-reanimated';

/**
 * 움직임 값 — Toss 디자인 시스템 motion 표(docs/design/Toss-DESIGN.md §15)를 옮긴 것.
 *
 * <p>화면에서 숫자를 직접 적지 않는다. 기기에서 "동작 줄이기"를 켜 두면 reanimated 가
 * (기본값 ReduceMotion.System) 애니메이션 없이 끝 상태로 바로 옮긴다.
 */
export const motion = {
  fast: 150,
  standard: 250,
  /** 온보딩 단계 넘김처럼 강조가 필요한 전환. */
  slow: 400,
} as const;

export const easing = {
  /** 나타날 때 — 시트, 카드, 화면 진입. */
  enter: Easing.bezier(0.0, 0.0, 0.2, 1),
  /** 사라질 때 — 닫기, 걷어 내기. */
  exit: Easing.bezier(0.4, 0.0, 1, 1),
  /** 양방향 — 자리 옮기기, 펼치기. */
  standard: Easing.bezier(0.4, 0.0, 0.2, 1),
} as const;
