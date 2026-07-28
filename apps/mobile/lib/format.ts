/**
 * 안전한 한국어 날짜 포맷.
 * iOS(Hermes+Foundation Intl)는 Invalid Date를 toLocaleDateString하면 RangeError로 throw해
 * 화면 전체가 크래시난다(Android ICU는 "Invalid Date" 문자열 반환이라 안 터짐).
 * → 파싱 실패/포맷 실패 시 빈 문자열이나 ISO 날짜로 폴백한다.
 */
export function formatKoreanDate(
  value: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ko-KR', opts);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "2026. 7. 23. 오후 3:45" 형태의 날짜+시각. 파싱 실패 시 빈 문자열. */
export function formatKoreanDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** "2026년 7월" 형태의 월 라벨 (기록 섹션 그룹핑용). */
export function formatKoreanMonth(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  } catch {
    return d.toISOString().slice(0, 7);
  }
}
