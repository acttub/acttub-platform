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

/**
 * 마무리 화면의 「이어서 N줄부터 읽기」(SOMA-934) — 읽은 끝 줄 뒤의 첫 대사부터 대본 마지막 대사까지.
 * 뒤에 대사가 없으면 null. fromDialogue 는 시작 대사의 번호(1부터, wrapUpProgress 의 next 와 같다).
 */
export function continueRange(
  lines: readonly ScriptLine[],
  endIndex: number,
): { startIndex: number; endIndex: number; fromDialogue: number } | null {
  let count = 0;
  let start = -1;
  let fromDialogue = 0;
  let last = -1;
  lines.forEach((l, i) => {
    if (l.type !== 'dialogue') return;
    count += 1;
    if (i > endIndex && start < 0) {
      start = i;
      fromDialogue = count;
    }
    last = i;
  });
  return start < 0 ? null : { startIndex: start, endIndex: last, fromDialogue };
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

/** 코칭 장면 칸 한 칸의 최대 글자 수(lib/practice/start SCENE_MAX 와 같다). */
const COACH_SCENE_MAX = 300;

/**
 * 리딩 마무리 「이 장면, 찍어서 코치에게 보여 주기」로 코칭에 넘길 장면(SOMA-772). 상황 = 대본 제목 · 연습 구간의 장면,
 * 인물 = 내 배역. 원하는 것은 배우가 적는다.
 */
export function readingCoachScene(input: {
  title: string;
  lineIds: readonly string[];
  scenes: readonly { no: number; title: string | null; start_line_id: string; end_line_id: string }[];
  startIndex: number;
  myRoles: readonly string[];
  t: (key: string, params?: Record<string, string | number>) => string;
}): { situation: string; character: string; goal: string } {
  const scene = input.scenes.find((s) => {
    const from = input.lineIds.indexOf(s.start_line_id);
    const to = input.lineIds.indexOf(s.end_line_id);
    return from >= 0 && to >= from && input.startIndex >= from && input.startIndex <= to;
  });
  const label = scene ? (scene.title ?? input.t('reading.rangeScene', { n: scene.no })) : null;
  const situation = label ? `${input.title} · ${label}` : input.title;
  return {
    situation: situation.slice(0, COACH_SCENE_MAX),
    character: input.myRoles.join(', ').slice(0, COACH_SCENE_MAX),
    goal: '',
  };
}
