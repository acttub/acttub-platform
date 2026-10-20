import { lastNotePracticeId, recentGroups } from './groups.ts';
import type { PracticeGroup } from './types.ts';

/**
 * 코칭 탭 입구(pen 「새 · 코칭 입구 첫/다음」, SOMA-748).
 * - 노트가 생긴 묶음이 없으면(숨긴 묶음만 있거나, 1턴만 하고 노트 없이 나갔어도) 처음 화면 — 마스코트가 진행을
 *   설명하고 「영상 보여 주고 코칭 받기」를 권한다.
 * - 있으면 노트가 있는 가장 최근 묶음의 마지막 노트를 「지난번 다음에 해볼 것」으로 띄운다. 그 자리에는 노트의
 *   다음 테이크 문장(next_take)을 쓰고, 노트 제목(코치 관찰)은 쓰지 않는다. 다음 테이크 문장은 목록에 없어서
 *   화면이 그 회차의 노트를 따로 불러온다(`notePracticeId`).
 */
export type CoachingEntry = { kind: 'first' } | { kind: 'next'; group: PracticeGroup; notePracticeId: string };

export function coachingEntry(groups: readonly PracticeGroup[]): CoachingEntry {
  for (const group of recentGroups(groups, groups.length)) {
    const notePracticeId = lastNotePracticeId(group);
    if (notePracticeId) return { kind: 'next', group, notePracticeId };
  }
  return { kind: 'first' };
}
