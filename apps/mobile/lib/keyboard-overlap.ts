/**
 * 키보드가 화면 아래에서 실제로 덮는 높이.
 *
 * 왜 endCoordinates.height를 그대로 못 쓰나
 *   안드로이드는 기기·네비게이션 방식(제스처/3버튼)·edge-to-edge 여부에 따라 이 값이 시스템 바를
 *   포함하기도 하고 빼기도 한다. 그래서 어떤 기기에서는 입력 바가 키보드에 반쯤 가렸다.
 *   화면 절대 좌표(screenY)로 "화면 바닥에서 키보드 윗변까지의 거리"를 직접 재고, 보고된 높이와
 *   비교해 더 큰 쪽을 쓴다 — 덜 올려서 가리는 것보다 조금 더 올려 여백이 생기는 편이 낫다.
 */
export type KeyboardMetrics = {
  height?: number | null;
  screenY?: number | null;
};

export function keyboardOverlap(
  metrics: KeyboardMetrics | null | undefined,
  screenHeight: number,
): number {
  if (!metrics) return 0;

  const reported = toFiniteNonNegative(metrics.height);
  const screenY = toFiniteNonNegative(metrics.screenY);
  const fromScreen =
    screenY !== null && Number.isFinite(screenHeight) && screenHeight > 0
      ? Math.max(0, screenHeight - screenY)
      : 0;

  const overlap = Math.max(reported ?? 0, fromScreen);
  // 화면 전체를 덮는 값은 잘못 읽은 것으로 보고 무시한다(레이아웃이 통째로 접히는 사고 방지).
  if (Number.isFinite(screenHeight) && screenHeight > 0 && overlap >= screenHeight) return 0;
  return overlap;
}

function toFiniteNonNegative(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}
