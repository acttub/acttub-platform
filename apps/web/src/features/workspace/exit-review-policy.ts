// 나가려는 배우에게 후기를 물을지 정하는 규칙.
// 브라우저 API를 쓰지 않아 그대로 테스트할 수 있다.

/** 열었다가 그냥 닫은 사람에게 다시 묻기까지 두는 기간. */
export const REVIEW_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 자동 창구(커서 이탈·뒤로가기)로 후기를 물어도 되는지.
 * 이미 남긴 사람에게는 다시 묻지 않고, 그냥 닫은 사람은 기간이 지나야 다시 묻는다.
 * 헤더의 마치기는 배우가 직접 누른 것이라 이 규칙을 타지 않는다.
 */
export function canAskAutomatically(
  doneFlag: string | null,
  askedAt: string | null,
  now: number,
): boolean {
  if (doneFlag === "1") return false;
  const previous = Number(askedAt);
  if (!Number.isFinite(previous) || previous <= 0) return true;
  return now - previous >= REVIEW_QUIET_MS;
}
