/**
 * 연습 탭 주소의 mode — 예전 「리딩 | 코칭」 전환의 이름이다. 지금 연습 탭은 한 페이지라 고르는 쪽을 기억하지 않고,
 * 다른 화면·알림이 `practiceHref('coaching')` 으로 보내면 그 페이지의 코칭 구역으로 내려 준다(app/(tabs)/practice).
 */
export type PracticeMode = 'reading' | 'coaching';

export function isPracticeMode(value: unknown): value is PracticeMode {
  return value === 'reading' || value === 'coaching';
}

/** 연습 탭을 여는 주소. coaching 이면 코칭 구역으로 내려 준다. */
export function practiceHref(mode: PracticeMode): `/practice?mode=${PracticeMode}` {
  return `/practice?mode=${mode}`;
}
