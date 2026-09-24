import { isKorean, translate as t } from './i18n.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * 올린 시각 — "방금 / 5분 전 / 3시간 전 / 2일 전", 일주일이 넘으면 "9월 12일"(지난해면 연도까지).
 * 챌린지 참여작 목록에서 언제 올렸는지 보여 준다 (SOMA-494). 못 읽는 값은 빈 문자열이다.
 */
export function postedAtLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const diff = now.getTime() - at.getTime();
  if (diff < MIN) return t('time.justNow');
  if (diff < HOUR) return t('time.minutesAgo', { n: Math.floor(diff / MIN) });
  if (diff < DAY) return t('time.hoursAgo', { n: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t('time.daysAgo', { n: Math.floor(diff / DAY) });
  const month = at.getMonth() + 1;
  const day = at.getDate();
  if (at.getFullYear() === now.getFullYear()) {
    return isKorean() ? `${month}월 ${day}일` : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return isKorean()
    ? `${at.getFullYear()}년 ${month}월 ${day}일`
    : at.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
