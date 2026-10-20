import { coachingEntry } from './practice/coaching-entry.ts';
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

type TodayChallenge = { id: string; line: string; work: string; ends_at: string };

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
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
}

/**
 * 첫 연습을 끝내기 전인가 — 코칭 묶음(숨긴 것 포함)·만든 대본·기기에 남은 연습한 날이 하나도 없다.
 * 대본을 만든(리딩을 시작한) 사람은 선택지 셋 대신 진행 상황에 맞춘 「오늘 할 것」을 본다.
 */
export function isFirstUser(input: {
  groups: readonly PracticeGroup[];
  scripts: readonly unknown[];
  practicedDays: number;
}): boolean {
  if (input.groups.length > 0) return false;
  if (input.practicedDays > 0) return false;
  return input.scripts.length === 0;
}

/** 챌린지 마감까지 남은 한국 날짜 수. 오늘 마감이면 0, 이미 지났으면 음수, 모르면 null. */
export function challengeDaysLeft(endsAt: string, now: Date): number | null {
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return null;
  return kstDayIndex(ends) - kstDayIndex(now.getTime());
}

export function pickToday(input: {
  groups: readonly PracticeGroup[];
  scripts: readonly ScriptCard[];
  challenge: TodayChallenge | null;
  now: Date;
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
  if (candidates.length > 0) return { main: candidates[0].item, also: candidates[1]?.item ?? null };

  if (input.challenge && timeOf(input.challenge.ends_at) > input.now.getTime()) {
    const daysLeft = challengeDaysLeft(input.challenge.ends_at, input.now);
    if (daysLeft !== null && daysLeft >= 0) {
      return { main: { kind: 'challenge', challenge: input.challenge, daysLeft }, also: null };
    }
  }
  return { main: { kind: 'start' }, also: null };
}

/** 오늘의 연기 팁 — 하루(기기 시간대) 동안 같은 팁을 보인다. */
export function tipIndex(now: Date, count: number): number {
  if (count <= 0) return 0;
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY_MS);
  return ((day % count) + count) % count;
}
