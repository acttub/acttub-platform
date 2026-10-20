/**
 * 프로필 탭(pen S14, SOMA-748)의 「이번 달 연습」 집계와 「연습 기록」 카드 순서. 서버에 집계 API 가 없어 이미 받는
 * 목록(연습 묶음·리딩 회차·내 참여작)으로 기기에서 센다. 이번 달은 기기 시각 기준 달력 달이다.
 */

import { countedPractices, type CountedPracticeInput } from './practice/counted.ts';

/** 기기 시각 기준 now 와 같은 달력 달인가. 날짜가 없거나 잘못됐으면 거짓. */
export function inMonth(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
}

export type MonthPracticeCounts = { coaching: number; reading: number; challenge: number; total: number };

/**
 * 「연습 1회」 기준(lib/practice/counted.ts) 하나로 이번 달 것만 센다(SOMA-773) — 코칭은 노트가 생긴 회차, 리딩은 끝까지
 * 읽은 회차, 챌린지는 올린 참여작 하나가 1회다(같은 챌린지에 두 번 올리면 2회).
 */
export function monthPracticeCounts(input: CountedPracticeInput, now: Date): MonthPracticeCounts {
  const counts = { coaching: 0, reading: 0, challenge: 0 };
  for (const p of countedPractices(input)) if (inMonth(p.at, now)) counts[p.kind] += 1;
  return { ...counts, total: counts.coaching + counts.reading + counts.challenge };
}

type CardGroup = {
  hidden_at: string | null;
  last_practiced_at?: string | null;
  practices: readonly { created_at: string }[];
};

/** 묶음의 마지막 연습 시각 — 목록이 채워 준 값, 없으면 회차 중 가장 늦은 것. */
function lastAt(group: CardGroup): string | null {
  if (group.last_practiced_at) return group.last_practiced_at;
  const times = group.practices.map((p) => p.created_at).filter((v) => !Number.isNaN(Date.parse(v)));
  return times.sort().at(-1) ?? null;
}

/** 연습 기록 탭 카드 — 숨긴 묶음은 빼고, 마지막 연습이 최근인 것부터. */
export function profileTabCards<G extends CardGroup>(groups: readonly G[]): { group: G; at: string | null }[] {
  return groups
    .filter((group) => !group.hidden_at)
    .map((group) => ({ group, at: lastAt(group) }))
    .sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0));
}
