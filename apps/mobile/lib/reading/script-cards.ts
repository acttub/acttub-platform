/**
 * 대본 목록 카드(R00)의 표시 규칙(reading.script). 수치는 모두 서버 집계이고 여기는 문구만 만든다.
 * 상태 칩은 셋뿐이다 — pen의 "분석 완료"는 리딩에 분석이 없으므로 없다.
 */
import type { ScriptCard, ScriptCardStatus, ScriptListResponse } from './types.ts';
import { dateLocale, translate as t } from '../i18n.ts';

export type StatusChip = { label: string; tone: ScriptCardStatus };

export function listHeader(list: Pick<ScriptListResponse, 'total_count' | 'in_progress_count'>): string {
  return t('reading.listHeader', { total: list.total_count, inProgress: list.in_progress_count });
}

export function statusChip(card: Pick<ScriptCard, 'status'>): StatusChip {
  switch (card.status) {
    case 'reading':
      return { label: t('reading.statusPlaying'), tone: 'reading' };
    case 'completed':
      return { label: t('reading.statusDone'), tone: 'completed' };
    default:
      return { label: t('reading.statusRole'), tone: 'no_cast' };
  }
}

/** 마지막 회차의 내 배역. 회차가 없으면 "배역 미선택". */
export function myCharactersLabel(card: Pick<ScriptCard, 'my_character_names'>): string {
  return card.my_character_names.length > 0 ? card.my_character_names.join(', ') : t('reading.noCast');
}

export function cardMeta(card: Pick<ScriptCard, 'dialogue_count' | 'recording_count'>): string {
  return t('reading.cardMeta', { dialogues: card.dialogue_count, recordings: card.recording_count });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "오늘"·"어제"·"5월 25일". */
export function relativeDay(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return t('reading.today');
  if (days === 1) return t('reading.yesterday');
  return new Date(at).toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/**
 * 마지막 활동 — "어제 연습", "5월 25일 업로드". 회차를 한 번이라도 시작했으면(내 배역이 있으면)
 * 연습이고, 아니면 등록(업로드)이 마지막 활동이다.
 */
export function lastActivityLabel(
  card: Pick<ScriptCard, 'last_activity_at' | 'my_character_names'>,
  now: number = Date.now(),
): string {
  if (!card.last_activity_at) return '';
  const when = relativeDay(card.last_activity_at, now);
  if (!when) return '';
  return card.my_character_names.length > 0
    ? t('reading.activityPractice', { when })
    : t('reading.activityUpload', { when });
}
