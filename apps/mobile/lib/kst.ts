/** 하루(밀리초). */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** 한국 시간(UTC+9, 일광 절약 없음). 날짜 경계는 기기 시간대와 상관없이 한국 시간으로 센다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 날짜 키(YYYY-MM-DD). 읽을 수 없는 시각이면 빈 문자열. */
export function kstDayKey(value: string | number | Date): string {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 한국 시간 기준 몇 번째 날인가 — 두 시각의 날짜 차이를 셀 때 쓴다. */
export function kstDayIndex(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}
