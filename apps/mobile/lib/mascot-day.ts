/** 기기 시간대 기준 오늘 고를 자리(0 ~ length-1) — 하루 동안은 같고 날마다 하나씩 넘어간다. */
export function dailyIndex(length: number, now: Date = new Date()): number {
  if (length <= 0) return 0;
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  return ((day % length) + length) % length;
}
