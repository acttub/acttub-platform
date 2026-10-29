import { getAppConfig } from './app-config.ts';
import { coachingEntry } from './practice/coaching-entry.ts';
import type { CountedPractice, PracticeKind } from './practice/counted.ts';
import type { PracticeGroup } from './practice/types.ts';
import type { ScriptCard } from './reading/types.ts';

/**
 * 홈 「오늘 할 것」(pen 일반 홈 BTT6at·SSeGm·gVzpd, 첫 사용자 홈 bHxn1I, SOMA-748).
 *
 * 홈은 하나이고 할 일은 카드 하나다. 가장 최근에 하다 만 것(코칭 숙제·이어 읽을 대본)을 고르고, 같은 시각이면
 * 코칭 숙제 > 리딩이다. 남은 하나는 그 아래 「하던 거」 한 줄로 둔다. 둘 다 없으면 진행 중인 오늘의 챌린지,
 * 그것도 없으면 연습을 시작하자는 카드다. "오늘 알림 보낸 것"을 먼저 고르는 규칙과 일정 D-day는 서버 기능이
 * 없어 아직 빠져 있다.
 */

type TodayChallenge = { id: string; line: string; work: string; ends_at: string; entry_count?: number };

export type TodayItem =
  | { kind: 'coaching'; group: PracticeGroup; notePracticeId: string }
  | { kind: 'reading'; script: ScriptCard }
  | { kind: 'challenge'; challenge: TodayChallenge; daysLeft: number }
  | { kind: 'start' };

export type TodayPick = { main: TodayItem; also: TodayItem | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDayIndex(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}

function timeOf(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
}

/**
 * 첫 연습을 끝내기 전인가 — 「연습 1회」(lib/practice/counted: 코칭 노트·리딩 완료·챌린지 참여)를 한 번도 끝내지 않았다(SOMA-827).
 * 기기에 남은 연습한 날, 노트가 생긴 코칭 회차(숨긴 묶음 포함), 끝까지 읽은 대본 중 하나라도 있으면 아니다.
 * 코칭을 노트 전에 나갔거나 대본만 넣은(예시 포함) 사람은 아직 첫 사용자다 — 한 번은 끝까지 해야 기본 홈으로 간다.
 */
export function isFirstUser(input: {
  groups: readonly { practices: readonly { note: unknown }[] }[];
  scripts: readonly { status?: string }[];
  practicedDays: number;
}): boolean {
  if (input.practicedDays > 0) return false;
  if (input.groups.some((g) => g.practices.some((p) => !!p.note))) return false;
  return !input.scripts.some((s) => s.status === 'completed');
}

/** 챌린지 마감까지 남은 한국 날짜 수. 오늘 마감이면 0, 이미 지났으면 음수, 모르면 null. */
export function challengeDaysLeft(endsAt: string, now: Date): number | null {
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return null;
  return kstDayIndex(ends) - kstDayIndex(now.getTime());
}

/** 주 기능을 보는 기간 — 연속일·주간 점과 같은 최근 2주. */
const PRIMARY_LOOKBACK_DAYS = 14;

/**
 * 사용자가 주로 한 기능(코칭·리딩·챌린지) — 최근 2주에 센 연습(lib/practice/counted)이 가장 많은 것.
 * 같으면 더 최근에 한 쪽이다. 한 번도 없으면 null.
 */
export function primaryFeature(
  practices: readonly CountedPractice[],
  now: Date,
  lookbackDays = PRIMARY_LOOKBACK_DAYS,
): PracticeKind | null {
  const since = now.getTime() - lookbackDays * DAY_MS;
  const stats = new Map<PracticeKind, { count: number; last: number }>();
  for (const p of practices) {
    const at = timeOf(p.at);
    if (at < since || at > now.getTime() + DAY_MS) continue;
    const cur = stats.get(p.kind) ?? { count: 0, last: -Infinity };
    stats.set(p.kind, { count: cur.count + 1, last: Math.max(cur.last, at) });
  }
  let best: PracticeKind | null = null;
  for (const [kind, v] of stats) {
    const b = best ? stats.get(best)! : null;
    if (!b || v.count > b.count || (v.count === b.count && v.last > b.last)) best = kind;
  }
  return best;
}

export function pickToday(input: {
  groups: readonly PracticeGroup[];
  scripts: readonly ScriptCard[];
  challenge: TodayChallenge | null;
  now: Date;
  /** 주 기능 — 그 기능으로 할 일이 있으면 가장 최근 것보다 먼저 고른다. */
  primary?: PracticeKind | null;
}): TodayPick {
  const candidates: { item: TodayItem; at: number; rank: number }[] = [];

  const coaching = coachingEntry(input.groups);
  if (coaching.kind === 'next') {
    candidates.push({
      item: { kind: 'coaching', group: coaching.group, notePracticeId: coaching.notePracticeId },
      at: timeOf(coaching.group.last_practiced_at),
      rank: 0,
    });
  }

  // 다 읽지 않은 대본 — 읽던 것은 마지막 회차 시각, 만들어 두고 아직 안 읽은 것은 등록 시각(last_activity_at)으로 견준다.
  const readingAt = (s: ScriptCard) => timeOf(s.last_practiced_at ?? s.last_activity_at);
  const reading = input.scripts
    .filter((s) => s.status !== 'completed')
    .sort((a, b) => readingAt(b) - readingAt(a))[0];
  if (reading) candidates.push({ item: { kind: 'reading', script: reading }, at: readingAt(reading), rank: 1 });

  candidates.sort((a, b) => b.at - a.at || a.rank - b.rank);

  let challengeItem: TodayItem | null = null;
  if (input.challenge && timeOf(input.challenge.ends_at) > input.now.getTime()) {
    const daysLeft = challengeDaysLeft(input.challenge.ends_at, input.now);
    if (daysLeft !== null && daysLeft >= 0) challengeItem = { kind: 'challenge', challenge: input.challenge, daysLeft };
  }

  // 주 기능이 챌린지면 열린 챌린지가 메인이고, 하던 코칭·리딩 하나는 그 아래로 간다.
  if (input.primary === 'challenge' && challengeItem) return { main: challengeItem, also: candidates[0]?.item ?? null };
  const primaryAt = candidates.findIndex((c) => c.item.kind === input.primary);
  if (primaryAt > 0) candidates.unshift(...candidates.splice(primaryAt, 1));
  if (candidates.length > 0) return { main: candidates[0].item, also: candidates[1]?.item ?? null };

  if (challengeItem) return { main: challengeItem, also: null };
  return { main: { kind: 'start' }, also: null };
}

/** 오늘의 연기 팁 — 하루(기기 시간대) 동안 같은 팁을 보인다. */
export function tipIndex(now: Date, count: number): number {
  if (count <= 0) return 0;
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY_MS);
  return ((day % count) + count) % count;
}

/** 오늘의 연기 팁 문장(SOMA-939) — 서버 설정의 팁 목록(기본값은 locales 의 home.tips)에서 고른다. 목록이 비면 null. */
export function todayTip(now: Date, language: 'ko' | 'en'): string | null {
  const tips = getAppConfig().homeTips[language];
  return tips.length > 0 ? tips[tipIndex(now, tips.length)] : null;
}
