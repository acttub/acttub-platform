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
export type CoachingEntry =
  | { kind: 'first' }
  | { kind: 'next'; group: PracticeGroup; notePracticeId: string }
  | { kind: 'resume'; group: PracticeGroup };

/**
 * - 가장 최근 묶음이 노트 없이 대화 중인 채로 남았으면(1턴만 하고 나간 경우 등) 처음 화면 대신 「하던 코칭 · 이어서 하기」를
 *   띄운다(10/20 피드백 — 탭을 옮겼다 오면 「코칭이 처음이죠?」만 떠서 하던 대화를 다시 찾기 어려웠다). 끝나지 않은
 *   코칭으로는 「지난번 다음에 해볼 것」을 만들지 않는다.
 */
export function coachingEntry(groups: readonly PracticeGroup[]): CoachingEntry {
  const recent = recentGroups(groups, groups.length);
  const latest = recent[0];
  if (latest?.in_progress_practice_id && !lastNotePracticeId(latest)) return { kind: 'resume', group: latest };
  for (const group of recent) {
    const notePracticeId = lastNotePracticeId(group);
    if (notePracticeId) return { kind: 'next', group, notePracticeId };
  }
  return { kind: 'first' };
}
