/**
 * 코치 말 속 「0:12」 같은 영상 시간(pen 「추가 · 시간 눌러 장면 보기」, SOMA-748).
 *
 * 코치 글을 글 조각과 시간 조각으로 나눈다. 화면은 시간 조각을 눌러 그 초부터 영상을 튼다. 앞뒤에 숫자가 붙었거나
 * 초가 60 이상이면 시간이 아니다(비율·시각 꼴을 잘못 잡지 않게).
 */
export type TimestampPart = { kind: 'text'; text: string } | { kind: 'time'; text: string; seconds: number };

const PATTERN = /(?<!\d)(\d{1,2}):([0-5]\d)(?!\d)/g;

export function timestampSeconds(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function splitTimestamps(text: string): TimestampPart[] {
  const parts: TimestampPart[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'time', text: match[0], seconds: Number(match[1]) * 60 + Number(match[2]) });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}
