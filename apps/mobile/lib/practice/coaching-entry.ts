import { recentGroups } from './groups.ts';
import type { PracticeGroup } from './types.ts';

/**
 * 코칭 탭 입구(pen 「새 · 코칭 입구 첫/다음」, SOMA-748).
 * - 연습이 없으면(숨긴 묶음만 있어도) 처음 화면 — 마스코트가 진행을 설명하고 「영상 보여 주고 코칭 받기」를 권한다.
 * - 있으면 가장 최근 묶음의 마지막 노트를 「지난번 다음에 해볼 것」으로 띄운다. 노트의 다음 테이크 문장은
 *   목록에 없어서 화면이 그 회차의 노트를 따로 불러온다(`notePracticeId`).
 */
export type CoachingEntry =
  | { kind: 'first' }
  | { kind: 'next'; group: PracticeGroup; notePracticeId: string | null; noteTitle: string | null };

export function coachingEntry(groups: readonly PracticeGroup[]): CoachingEntry {
  const [latest] = recentGroups(groups, 1);
  if (!latest) return { kind: 'first' };
  const withNote = [...latest.practices].reverse().find((round) => round.note);
  return {
    kind: 'next',
    group: latest,
    notePracticeId: withNote?.id ?? null,
    noteTitle: withNote?.note?.title ?? null,
  };
}
