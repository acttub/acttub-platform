/**
 * 리딩 화면 개편(SOMA-748)에서 새로 생긴 표시 규칙. 서버 값은 그대로 쓰고 무엇을 보일지만 정한다.
 */
import type { ImportStop } from './script-import.ts';
import type { ScriptCard, ScriptLine, SessionCard } from './types.ts';

/** 내 대본 「이전에 하던 데부터」 카드에 올릴 대본 — 목록(최근 고친 순)에서 처음 나오는 연습 중 대본. */
export function resumeCandidate<T extends Pick<ScriptCard, 'status'>>(scripts: readonly T[]): T | null {
  return scripts.find((s) => s.status === 'reading') ?? null;
}

/** 이어 읽을 회차 — 진행 위치(done/total)가 있는 진행 중 회차. */
export function resumeSessionOf<T extends Pick<SessionCard, 'status' | 'progress'>>(sessions: readonly T[]): T | null {
  return sessions.find((s) => s.status === 'in_progress' && !!s.progress) ?? null;
}

/** 「대본을 못 나눴어요」 화면으로 보일 멈춤 — 다시 하거나 직접 붙여 넣으면 풀릴 수 있는 것만. */
export function isSplitFailure(stop: Pick<ImportStop, 'kind'>): boolean {
  return stop.kind === 'file_unreadable' || stop.kind === 'no_characters' || stop.kind === 'error';
}

const FIRST_PRACTICE_DIALOGUES = 10;

/**
 * 첫 연습의 짧은 구간 — 처음부터 대사 10줄. 대본이 그보다 짧거나 그 안에 내 대사가 없으면 추천하지 않는다(null).
 * lastText 는 구간 이름(「처음 ~ 「…」」)에 쓴다.
 */
export function firstPracticeRange(
  lines: readonly ScriptLine[],
  myRoles: readonly string[],
): { startIndex: number; endIndex: number; dialogueCount: number; myCount: number; lastText: string } | null {
  const dialogues: number[] = [];
  lines.forEach((l, i) => {
    if (l.type === 'dialogue') dialogues.push(i);
  });
  if (dialogues.length <= FIRST_PRACTICE_DIALOGUES) return null;
  const picked = dialogues.slice(0, FIRST_PRACTICE_DIALOGUES);
  const myCount = picked.filter((i) => {
    const l = lines[i];
    return l.type === 'dialogue' && myRoles.includes(l.role);
  }).length;
  if (myCount === 0) return null;
  const endIndex = picked[picked.length - 1];
  return { startIndex: picked[0], endIndex, dialogueCount: picked.length, myCount, lastText: lines[endIndex].text };
}

/** 리딩 마무리 — 이번에 읽은 끝 줄의 대사 번호, 전체 대사 수, 다음에 시작할 대사 번호(끝까지 읽었으면 null). */
export function wrapUpProgress(lines: readonly ScriptLine[], endIndex: number): { readTo: number; total: number; next: number | null } {
  let readTo = 0;
  let total = 0;
  lines.forEach((l, i) => {
    if (l.type !== 'dialogue') return;
    total += 1;
    if (i <= endIndex) readTo = total;
  });
  return { readTo, total, next: readTo < total ? readTo + 1 : null };
}

/** 첫 리딩 안내(pen 「리딩 실행 · 처음」) — 진행 상태를 보고 하나씩 띄운다. 진행 규칙은 바꾸지 않는다. */
export const COACH_MARKS = ['partner', 'mine', 'next', 'alone'] as const;
export type CoachMark = (typeof COACH_MARKS)[number];

export function coachMarkFor(ctx: {
  done: ReadonlySet<CoachMark>;
  status: string;
  /** 내 차례에 알아들은 말이 있다. */
  said: boolean;
  /** 지금 내 대사가 가려져 있다(첫 단어 도움이 보인다). */
  hiddenMine: boolean;
}): CoachMark | null {
  const holds: Record<CoachMark, boolean> = {
    partner: ctx.status === 'partner',
    mine: ctx.status === 'mine' && !ctx.said,
    next: ctx.status === 'mine' && ctx.said,
    alone: ctx.status === 'mine' && ctx.hiddenMine && ctx.done.has('next'),
  };
  return COACH_MARKS.find((m) => !ctx.done.has(m) && holds[m]) ?? null;
}
