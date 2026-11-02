import { api } from '@/lib/api';

/**
 * 내가 참여작(나만 보기·확인 중 포함)을 올린 챌린지 id (SOMA-995).
 * 공개 참여작 수(entry_count)에는 나만 보기가 빠지므로, 화면이 「첫 번째로 참여해 보세요」를 띄울지는 이걸로 정한다.
 * 홈(SOMA-829)과 같은 목록(내 참여작 첫 쪽)을 쓴다. 못 받으면 빈 집합 — 지금처럼 보인다.
 */
export async function enteredChallengeIds(): Promise<ReadonlySet<string>> {
  try {
    const { entries } = await api.listMyChallengeEntries();
    return new Set(entries.flatMap((entry) => (entry.challenge?.id ? [entry.challenge.id] : entry.challenge_id ? [entry.challenge_id] : [])));
  } catch {
    return new Set();
  }
}
