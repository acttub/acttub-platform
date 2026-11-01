/**
 * 대본 상세의 회차 카드가 보여 주는 말(reading.session). 순수 함수라 화면 없이 테스트한다.
 */

export function sessionDateLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${pick("month")}월 ${pick("day")}일`;
}
