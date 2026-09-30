export const MAX_VIDEO_DURATION_MS = 300_000;

export function normalizeVideoDurationMs(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * 장면 칸은 다듬은 값 그대로 보낸다 — 비면 빈 문자열이다(ADR-021, 웹과 같은 값). 자리표시자는
 * 만들지 않는다. 예전 빌드가 보내던 '.'은 서버가 빈 값으로 저장한다.
 */
export function sceneValueForSubmit(value: string): string {
  return value.trim();
}
