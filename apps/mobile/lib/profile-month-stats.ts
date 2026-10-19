/**
 * 프로필 탭(pen S14, SOMA-748)의 「이번 달 연습」 집계와 「연습 기록」 카드 순서. 서버에 집계 API 가 없어 이미 받는
 * 목록(연습 묶음·리딩 회차·내 참여작)으로 기기에서 센다. 이번 달은 기기 시각 기준 달력 달이다.
 */

/** 기기 시각 기준 now 와 같은 달력 달인가. 날짜가 없거나 잘못됐으면 거짓. */
export function inMonth(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
}

export type MonthPracticeCounts = { coaching: number; reading: number; challenge: number; total: number };

/**
 * 코칭은 회차(묶음 안 practices), 리딩은 회차(started_at)를 센다. 챌린지는 이번 달에 참여한 서로 다른 챌린지 수다 —
 * 프로필의 챌린지 수는 참여작 수가 아니라 챌린지 수로 센다(SOMA-738, participatedChallengeCount 와 같은 뜻).
 */
export function monthPracticeCounts(
  input: {
    groups: readonly { practices: readonly { created_at: string }[] }[];
    readingSessions: readonly { started_at: string }[];
    entries: readonly { created_at: string; challenge: { id: string } }[];
  },
  now: Date,
): MonthPracticeCounts {
  const coaching = input.groups.reduce(
    (sum, group) => sum + group.practices.filter((p) => inMonth(p.created_at, now)).length,
    0,
  );
  const reading = input.readingSessions.filter((s) => inMonth(s.started_at, now)).length;
  const challenge = new Set(input.entries.filter((e) => inMonth(e.created_at, now)).map((e) => e.challenge.id)).size;
  return { coaching, reading, challenge, total: coaching + reading + challenge };
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
