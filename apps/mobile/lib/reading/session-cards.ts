/**
 * 대본 상세의 연습 기록 목록과 회차 상세(R4, reading.session · reading.recording)의 표시 규칙. 수치는 서버 집계다.
 * 회차 상태는 진행 중·완료 둘이다.
 */
import type { ScriptLine } from './parse.ts';
import { latestRecordings } from './recording-plan.ts';
import { relativeDay } from './script-cards.ts';
import { dialogueNumbers, rangeName, rangeTitle } from './session-plan.ts';
import type { SessionCard, SessionDetail, SessionRecording } from './types.ts';
import { translate as t } from '../i18n.ts';

/** "0:41"·"10:05" — 분은 자리 채움 없이. */
export function shortTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 회차 구간 이름 — "장면 2"·"대사 5~12번"·"처음부터 끝까지". */
export function sessionRangeTitle(lines: ScriptLine[], card: Pick<SessionCard, 'range'>): string {
  return rangeTitle(rangeName(lines, card.range.start_dialogue_no, card.range.end_dialogue_no), t);
}

function rolesLabel(card: Pick<SessionCard, 'my_character_names'>): string {
  return card.my_character_names.join('·') || t('reading.noCast');
}

/** 연습 기록 줄 — "태오 · 녹음 7개 · 4:12". */
export function sessionCardMeta(card: Pick<SessionCard, 'my_character_names' | 'recorded_line_count' | 'elapsed_seconds'>): string {
  return [rolesLabel(card), t('reading.sessionRecordings', { count: card.recorded_line_count }), shortTime(card.elapsed_seconds)].join(' · ');
}

/** 회차 상세 머리 — "태오 · 5월 25일 · 1:05". */
export function sessionDetailMeta(
  card: Pick<SessionCard, 'my_character_names' | 'started_at' | 'elapsed_seconds'>,
  now: number = Date.now(),
): string {
  return [rolesLabel(card), relativeDay(card.started_at, now), shortTime(card.elapsed_seconds)].join(' · ');
}

/** "이어서 연습 · K/N줄" — N 은 구간 대사 수, K 는 현재 줄(대사 번호) 앞까지의 대사 수. */
export function resumeProgress(card: Pick<SessionCard, 'range'>, currentDialogueNo: number | null): { k: number; n: number } {
  const n = card.range.end_dialogue_no - card.range.start_dialogue_no + 1;
  const k = currentDialogueNo === null ? 0 : Math.min(n, Math.max(0, currentDialogueNo - card.range.start_dialogue_no));
  return { k, n };
}

/** 진행 중 회차의 K/N. 완료 회차는 null. */
export function sessionProgress(
  script: { lines: ScriptLine[]; lineIds: string[] },
  detail: Pick<SessionDetail, 'status' | 'range' | 'current_line_id'>,
): { k: number; n: number } | null {
  if (detail.status === 'completed') return null;
  const index = detail.current_line_id ? script.lineIds.indexOf(detail.current_line_id) : -1;
  return resumeProgress(detail, index < 0 ? null : dialogueNumbers(script.lines)[index]);
}

export type SessionChipTone = 'reading' | 'completed';

/** 상태 칩 — 완료(초록) / 진행 중 · K/N(파랑). K/N 을 아직 모르면 "진행 중"만. */
export function sessionChip(
  status: SessionCard['status'],
  progress: { k: number; n: number } | null,
): { label: string; tone: SessionChipTone } {
  if (status === 'completed') return { label: t('reading.sessionCompleted'), tone: 'completed' };
  return {
    label: progress ? t('reading.sessionInProgressAt', progress) : t('reading.sessionInProgress'),
    tone: 'reading',
  };
}

/** 회차 상세 「대본」의 한 줄. 「내 녹음만」은 recording 이 있는 줄만 고른다. */
export type SessionLine = {
  lineId: string;
  type: ScriptLine['type'];
  /** 대사 줄만. */
  role: string | null;
  text: string;
  /** 대사 줄만 1부터. */
  dialogueNo: number | null;
  mine: boolean;
  recording: SessionRecording | null;
  /** 다르게 말한 것으로 인식된 녹음의 전사. 맞게 말했거나 비교하지 않은 녹음은 null(원문만 보인다). */
  said: string | null;
  /** 진행 중 회차가 이어 할 줄. */
  resumeHere: boolean;
};

export function differentlySaid(rec: Pick<SessionRecording, 'matched' | 'transcript_source' | 'transcript'>): string | null {
  return rec.matched === false && rec.transcript_source === 'stt' && rec.transcript !== null ? rec.transcript : null;
}

/** 회차 구간의 모든 줄(지문·장면 포함)에 내 녹음을 붙인다. 같은 줄 녹음이 여럿이면 마지막 시도만. */
export function sessionLines(
  script: { lines: ScriptLine[]; lineIds: string[] },
  detail: Pick<SessionDetail, 'start_line_id' | 'end_line_id' | 'my_character_names' | 'status' | 'current_line_id' | 'recordings'>,
): SessionLine[] {
  const start = script.lineIds.indexOf(detail.start_line_id);
  const end = script.lineIds.indexOf(detail.end_line_id);
  if (start < 0 || end < start) return [];
  const latest = latestRecordings(detail.recordings);
  const mine = new Set(detail.my_character_names);
  const numbers = dialogueNumbers(script.lines);
  const resumeId = detail.status === 'completed' ? null : detail.current_line_id;
  return script.lines.slice(start, end + 1).map((line, offset) => {
    const lineId = script.lineIds[start + offset];
    const recording = latest.get(lineId) ?? null;
    return {
      lineId,
      type: line.type,
      role: line.type === 'dialogue' ? line.role : null,
      text: line.text,
      dialogueNo: numbers[start + offset],
      mine: line.type === 'dialogue' && mine.has(line.role),
      recording,
      said: recording ? differentlySaid(recording) : null,
      resumeHere: lineId === resumeId,
    };
  });
}

/** 재생 주소는 10분 서명이다. 만료됐거나 없으면 회차를 다시 조회해 새 주소를 받는다. */
export function isPlaybackExpired(rec: Pick<SessionRecording, 'playback_url' | 'playback_expires_at'>, now: number = Date.now()): boolean {
  if (!rec.playback_url) return true;
  if (!rec.playback_expires_at) return false;
  const at = Date.parse(rec.playback_expires_at);
  return Number.isNaN(at) ? false : at <= now;
}

/** [이 구간으로 다시 연습] → 새 연습 화면에 그 배역·구간이 골라진 채로. */
export function practiceAgainParams(detail: Pick<SessionDetail, 'my_character_ids' | 'start_line_id' | 'end_line_id'>): {
  roles: string;
  start: string;
  end: string;
} {
  return { roles: detail.my_character_ids.join(','), start: detail.start_line_id, end: detail.end_line_id };
}
