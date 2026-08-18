/**
 * 답이 온 그 순간의 오늘. 마감 D-day 와 "접수 중"인지가 이것을 기준으로 선다.
 *
 * 인자를 받는 까닭은 부르는 시각이 **응답이 온 시각**이어야 하기 때문이다 — 페이지를
 * 빌드 시점에 프리렌더하므로 렌더 중에 오늘을 읽으면 프리렌더된 HTML 과 어긋난다.
 * UTC 로 자르면 한국 오전에 하루가 밀린다.
 */
export function localDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
