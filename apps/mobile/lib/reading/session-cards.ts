/**
 * 회차 목록·상세(R00.5, reading.session · reading.recording)와 연습 기록(A1.1)의 표시 규칙. 수치는 서버 집계다.
 */
import { relativeDay } from './script-cards.ts';
import type { ReadingSessionStatus, SessionCard, SessionDetail, SessionRecording } from './types.ts';
import { translate as t } from '../i18n.ts';

/** "0:41"·"10:05" — 분은 자리 채움 없이. */
export function shortTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "3회차 · 어제" */
export function sessionCardTitle(card: Pick<SessionCard, 'ordinal' | 'started_at'>, now: number = Date.now()): string {
  return `${t('reading.sessionOrdinal', { n: card.ordinal })} · ${relativeDay(card.started_at, now)}`;
}

export function sessionStatusLabel(status: ReadingSessionStatus): string {
  if (status === 'in_progress') return t('reading.sessionInProgress');
  if (status === 'completed') return t('reading.sessionCompleted');
  return t('reading.sessionStopped');
}

/** "내 대사 5개 중 2개 녹음 · 0:41 · 40%" (N = 구간 안 내 대사 수, K = 녹음된 줄 수) */
export function recordingSummary(card: Pick<SessionCard, 'my_dialogue_count' | 'recorded_line_count' | 'elapsed_seconds'>): string {
  const n = card.my_dialogue_count;
  const k = card.recorded_line_count;
  const pct = n > 0 ? Math.round((k / n) * 100) : 0;
  return t('reading.recordingSummary', { n, k, time: shortTime(card.elapsed_seconds), pct });
}

/** "이어서 연습 · K / N" — N 은 구간 대사 수, K 는 현재 줄(대사 번호) 앞까지의 대사 수. */
export function resumeProgress(card: Pick<SessionCard, 'range'>, currentDialogueNo: number | null): { k: number; n: number } {
  const n = card.range.end_dialogue_no - card.range.start_dialogue_no + 1;
  const k = currentDialogueNo === null ? 0 : Math.min(n, Math.max(0, currentDialogueNo - card.range.start_dialogue_no));
  return { k, n };
}

export function recordingsInLineOrder(detail: Pick<SessionDetail, 'recordings'>, lineIds: string[]): SessionRecording[] {
  const order = new Map(lineIds.map((id, i) => [id, i] as const));
  return [...detail.recordings].sort((a, b) => (order.get(a.line_id) ?? Infinity) - (order.get(b.line_id) ?? Infinity));
}

/** "이어 듣기" — 재생 주소가 있는 내 대사 녹음을 줄 순서로. */
export function listenQueue(detail: Pick<SessionDetail, 'recordings'>, lineIds: string[]): SessionRecording[] {
  return recordingsInLineOrder(detail, lineIds).filter((r) => !!r.playback_url);
}

/** 재생 주소는 10분 서명이다. 만료됐거나 없으면 목록을 다시 조회해 새 주소를 받는다. */
export function isPlaybackExpired(rec: Pick<SessionRecording, 'playback_url' | 'playback_expires_at'>, now: number = Date.now()): boolean {
  if (!rec.playback_url) return true;
  if (!rec.playback_expires_at) return false;
  const at = Date.parse(rec.playback_expires_at);
  return Number.isNaN(at) ? false : at <= now;
}

