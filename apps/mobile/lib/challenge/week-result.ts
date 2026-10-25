import type { ChallengeCard, EntryCard } from './types.ts';

/**
 * 「지난주 결과」(SOMA-748 ljrKJM)와 「챌린지 마무리」(Ttlo3)의 표시 규칙.
 *
 * 서버 새 필드 없이 종료 탭 목록·확정 순위(rank)·마감 시각(ends_at)으로만 만든다. 상품 지급 기록은 서버에 없어
 * 선정작은 확정 순위 3위 안의 참여작이다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 끝난 지 이만큼 안이면 「지난주 결과」로 띄운다. */
export const LAST_WEEK_WINDOW_MS = 7 * DAY_MS;
/** 선정작 수. */
export const PICKED_MAX = 3;

/** 끝난 지 7일 안의 공식(team) 챌린지 중 가장 늦게 끝난 것. 참여작이 없으면 띄우지 않는다. */
export function lastWeekResult(ended: readonly ChallengeCard[], now: number = Date.now()): ChallengeCard | null {
  let best: ChallengeCard | null = null;
  let bestEnds = -Infinity;
  for (const challenge of ended) {
    const ends = Date.parse(challenge.ends_at);
    if (Number.isNaN(ends) || ends > now || now - ends > LAST_WEEK_WINDOW_MS) continue;
    if (challenge.origin !== 'team' || challenge.entry_count <= 0) continue;
    if (ends > bestEnds) {
      best = challenge;
      bestEnds = ends;
    }
  }
  return best;
}

/** 서버 확정 순위 3위 안의 참여작을 서버 순서대로 최대 셋. 순위가 없으면(집계 중·좋아요 0) 없다. */
export function pickedEntries<T extends Pick<EntryCard, 'rank'>>(entries: readonly T[]): T[] {
  return entries.filter((entry) => entry.rank !== null && entry.rank <= PICKED_MAX).slice(0, PICKED_MAX);
}

export type KstDate = { month: number; day: number; /** 0=일 … 6=토 */ weekday: number };

/** 한국 시간 기준의 월·일·요일. */
export function kstDate(iso: string | number): KstDate {
  const at = new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + KST_OFFSET_MS);
  return { month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: at.getUTCDay() };
}

/** "10/9~10/16" — 시작일부터 마감 직전 날까지. */
export function periodLabel(startsAt: string, endsAt: string): string {
  const from = kstDate(startsAt);
  const to = kstDate(Date.parse(endsAt) - 1);
  return `${from.month}/${from.day}~${to.month}/${to.day}`;
}

/** 결과가 나오는 날 — 마감 시각의 한국 날짜. */
export function resultDay(endsAt: string): KstDate {
  return kstDate(endsAt);
}
