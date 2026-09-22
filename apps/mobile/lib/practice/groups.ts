import { translate } from '../i18n.ts';
import type { PracticeGroup, PracticeGroupDetail, PracticeGroupFilter, PracticeGroupResponse, PracticeRound } from './types.ts';

/** 목록과 PATCH가 같은 서버 묶음 DTO를 준다. 화면에 필요한 요약은 회차에서 얻는다. */
export function practiceGroupFromResponse(group: PracticeGroupResponse): PracticeGroupDetail {
  const practices = [...group.practices].sort((a, b) => a.ordinal - b.ordinal);
  const first = practices[0];
  const last = practices.at(-1);
  return {
    ...group,
    note_title: last?.note_title ?? null,
    situation: first?.situation ?? null,
    last_practiced_at: last?.created_at ?? null,
    video_id: last?.video_id ?? null,
    last_conversation_id: [...practices].reverse().find(p => p.conversation_id)?.conversation_id ?? null,
    practices: practices.map(p => ({
      id: p.id, ordinal: p.ordinal, created_at: p.created_at, stage: p.stage,
      message_count: p.conversation_count,
      note: p.note_id && p.note_kind ? { id: p.note_id, title: p.note_title, kind: p.note_kind } : null,
      conversation_id: p.conversation_id,
      previous_conversations: p.previous_conversations,
    })),
  };
}

/**
 * 연습 기록(A1·A1.1·A1.2)의 규칙. 기록은 묶음 단위이고 회차는 그 안의 n차다.
 *
 * 묶음 제목은 마지막 회차 노트의 제목, 없으면 첫 회차의 상황 문장, 그것도 없으면 "제목 없는
 * 연습"이다. 숨김은 묶음 전체이고 노트·대화·기억은 지우지 않으며 영상은 보관함에 남는다.
 * 연속 연습 일수는 회차 시작 날짜를 한국 시간으로 세어 자정을 넘긴 회차가 다음 날로 간다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function groupTitle(group: Pick<PracticeGroup, 'title' | 'note_title' | 'situation'>): string {
  const fromServer = group.title?.trim();
  if (fromServer) return fromServer;
  const noteTitle = group.note_title?.trim();
  if (noteTitle) return noteTitle;
  const situation = group.situation?.trim();
  if (situation && situation !== '.') return situation;
  return translate('history.noSceneTitle');
}

/** 숨긴 묶음은 목록에서 빠진다. 필터는 전체·즐겨찾기·최근 30일이다. */
export function filterGroups(
  groups: readonly PracticeGroup[],
  filter: PracticeGroupFilter,
  now: number = Date.now(),
): PracticeGroup[] {
  const visible = groups.filter((g) => !g.hidden_at);
  if (filter === 'favorite') return visible.filter((g) => g.favorite);
  if (filter === 'recent30') {
    const since = now - 30 * DAY_MS;
    return visible.filter((g) => {
      const at = Date.parse(g.last_practiced_at ?? '');
      return Number.isNaN(at) ? false : at >= since;
    });
  }
  return visible;
}

/** 홈(A1)의 최근 연습 — 숨기지 않은 묶음 3개. */
export function recentGroups(groups: readonly PracticeGroup[], limit = 3): PracticeGroup[] {
  return [...filterGroups(groups, 'all')]
    .sort((a, b) => Date.parse(b.last_practiced_at ?? '') - Date.parse(a.last_practiced_at ?? ''))
    .slice(0, limit);
}

/** 한국 시간 기준 날짜 키(YYYY-MM-DD). 자정을 넘긴 회차는 다음 날로 센다. */
export function kstDayKey(value: string | number | Date): string {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 연속 연습 일수. 오늘(한국 시간)부터 거슬러 세고, 오늘 아직 안 했으면 어제까지의 연속을 지킨다.
 */
export function practiceStreak(startedAt: readonly string[], now: number = Date.now()): number {
  const days = new Set(startedAt.map((iso) => kstDayKey(iso)).filter(Boolean));
  let streak = 0;
  for (let i = 0; ; i += 1) {
    const key = kstDayKey(now - i * DAY_MS);
    if (days.has(key)) streak += 1;
    else if (i === 0) continue; // 오늘 아직 안 했어도 어제까지의 연속은 유지한다
    else break;
  }
  return streak;
}

export type HistoryRow = {
  id: string;
  /** 정렬 기준 — 회차 시작 시각(묶음은 마지막 회차). */
  at: string;
  kind: 'practice' | 'reading';
  title: string;
  meta: string;
};

/** 연습 묶음과 리딩 회차를 한 목록으로 섞는다(최신이 위). */
export function mergeHistoryRows(
  practices: readonly HistoryRow[],
  readings: readonly HistoryRow[],
): HistoryRow[] {
  return [...practices, ...readings].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** 회차 한 줄 — "2차 · 대화 6개 · 노트 제목". 노트가 없으면 아직 정리 없음이다. */
export function roundSummary(round: Pick<PracticeRound, 'ordinal' | 'message_count' | 'note'>): string {
  const parts = [
    translate('history.ordinal', { n: round.ordinal }),
    translate('history.messageCount', { count: round.message_count }),
    round.note ? round.note.title?.trim() || translate(`note.kind.${round.note.kind}`) : translate('note.none'),
  ];
  return parts.join(' · ');
}

/** 숨김이 무엇을 하는지 그대로 말한다. */
export function hideNotice(): string {
  return translate('history.hideNotice');
}
