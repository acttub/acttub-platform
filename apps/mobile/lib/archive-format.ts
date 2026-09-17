import { translate as t } from './i18n.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0:42 꼴 — 보관함 셀·상세의 길이 표시. */
export function formatClipDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** "오늘 / 어제 / N일 전" — 보관함 셀 밑 라벨. */
export function relativeDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / DAY_MS);
  if (days <= 0) return t('archive.today');
  if (days === 1) return t('archive.yesterday');
  return t('archive.daysAgo', { days });
}
