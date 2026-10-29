import type { ChallengeCard, EntriesResponse } from './types.ts';
import { lastWeekResult, pickedEntries } from './week-result.ts';

/**
 * 이번 주 대사 카드에 틀어 줄 「참여작 예시」 영상 주소(SOMA-920).
 *
 * 1순위는 지난주(직전 회차) 공식 챌린지의 선정작(확정 순위 3위 안)이다. 서버 목록은 공개·숨김 아님·삭제 아님·
 * 신고/AI 검사 숨김 아님만 내려주고, 얼굴 모자이크를 켠 참여작은 모자이크본 주소만 준다(없으면 playback_url 이 null).
 * 선정작이 없거나 재생 주소가 없으면 지금까지처럼 이번 주 참여작 중 좋아요 많은 순 첫 재생 가능 참여작으로 둔다.
 * 참여작 카드에는 팀 계정 표시가 없어 「팀 참여작」 단계는 따로 두지 않는다.
 */
export type ListEntries = (challengeId: string) => Promise<EntriesResponse>;

export async function loadExampleUrl(args: {
  ended: readonly ChallengeCard[];
  featuredId: string | null;
  listEntries: ListEntries;
  now?: number;
}): Promise<string | null> {
  const last = lastWeekResult(args.ended, args.now);
  if (last && last.id !== args.featuredId) {
    try {
      const picked = pickedEntries((await args.listEntries(last.id)).entries).find((e) => e.playback_url);
      if (picked?.playback_url) return picked.playback_url;
    } catch {
      // 지난주 조회가 실패하면 이번 주 참여작으로 넘어간다.
    }
  }
  if (!args.featuredId) return null;
  const current = await args.listEntries(args.featuredId);
  return current.entries.find((e) => e.playback_url)?.playback_url ?? null;
}
