/**
 * 듀오링고식 연속일 축하 (SOMA-479).
 *
 * 홈에 들어올 때마다 "오늘 연습으로 연속일이 늘었나"를 본다. 늘었으면 딱 한 번
 * 축하하고, 방금 본 연속일을 저장해 둔다. 같은 값으로 다시 들어오면 조용하다.
 * 연속이 끊겨 줄어든 경우도 저장만 갱신하고 축하하지 않는다.
 *
 * 판정(shouldCelebrateStreak)은 순수 함수라 node 테스트로 잠근다. AsyncStorage 는
 * 최상단에서 import 하지 않고 함수 안에서 lazy require 한다 — CI 의 mobile 잡은
 * npm 설치 없이 도는데(전례: i18next 사고), 최상단 네이티브 import 가 있으면
 * 순수 함수 테스트조차 모듈 로드에서 깨진다(lib/device-storage).
 */
import { deviceStorage as storage } from './device-storage.ts';
import { kstDayKey } from './kst.ts';

const LAST_SEEN_KEY = 'acttub.streak.lastSeen';
/** 마지막으로 본 연속일을 적은 날(한국 시간 YYYY-MM-DD). 같은 날에는 그 값을 낮추지 않는다(11/2 폰 QA). */
const LAST_SEEN_DAY_KEY = 'acttub.streak.lastSeenDay';

/** 한국 시간 오늘(YYYY-MM-DD). */
export function kstToday(now: number = Date.now()): string {
  return kstDayKey(now);
}

/** 지금 연속일이 마지막으로 본 값보다 크면(=오늘 늘었으면) 축하한다. */
export function shouldCelebrateStreak(lastSeen: number, current: number): boolean {
  if (!Number.isFinite(current) || current < 1) return false;
  const seen = Number.isFinite(lastSeen) ? lastSeen : 0;
  return current > seen;
}

/** 저장된 '마지막으로 본 연속일'. 없거나 깨졌으면 0. */
export async function readLastSeenStreak(): Promise<number> {
  try {
    const raw = await storage().getItem(LAST_SEEN_KEY);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    // 저장소를 못 읽으면 0으로 본다 — 최악은 축하가 한 번 더 뜨는 것뿐이다.
    return 0;
  }
}

/** 방금 본 연속일을 저장한다(오늘 날짜와 함께). 실패해도 조용히 넘어간다(축하는 곁다리 기능이다). */
export async function writeLastSeenStreak(current: number): Promise<void> {
  try {
    await storage().setItem(LAST_SEEN_KEY, String(Math.max(0, Math.trunc(current))));
    await storage().setItem(LAST_SEEN_DAY_KEY, kstToday());
  } catch {
    // 무시 — 다음 진입에서 다시 시도된다.
  }
}

/** 마지막으로 본 연속일을 적은 날. 옛 판(날짜 없이 적음)이거나 못 읽으면 null. */
export async function readLastSeenStreakDay(): Promise<string | null> {
  try {
    const raw = await storage().getItem(LAST_SEEN_DAY_KEY);
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export type CelebrationDot = { key: string; label: string; state: 'done' | 'today' | 'empty' };

/**
 * 전체화면 축하의 요일 점(SOMA-494). 오늘 연습한 칸은 화면에서 차오르는 칸이라 따로 가른다.
 * 지난 연습일은 이미 찬 칸, 나머지(쉰 날·앞날)는 빈 칸이다.
 */
export function celebrationDots(
  days: readonly { key: string; label: string; count: number; isToday: boolean }[],
): CelebrationDot[] {
  return days.map((day) => ({
    key: day.key,
    label: day.label,
    state: day.count > 0 ? (day.isToday ? 'today' : 'done') : 'empty',
  }));
}

/**
 * 홈이 연속일을 볼 때 할 일. 기록을 아직 못 받았으면(연속일이 잠깐 0) 아무것도 하지 않는다 —
 * 그때 0 을 기억하면 기록이 오는 순간 늘었다고 보고 매번 다시 축하한다(SOMA-494, 실기기).
 */
export function streakCelebrationStep(input: {
  loaded: boolean;
  lastSeen: number;
  current: number;
  /** 오늘(한국 시간) 센 연습이 있는가. */
  practicedToday: boolean;
  /** 기록 일부를 못 받았는가(오프라인 등). 그때 센 연속일은 실제보다 작을 수 있다. */
  failed?: boolean;
  /** lastSeen 을 적은 날과 오늘(한국 시간). 같은 날이면 기억을 낮추지 않는다. */
  lastSeenDay?: string | null;
  today?: string;
}): { celebrate: boolean; remember: number | null } {
  if (!input.loaded) return { celebrate: false, remember: null };
  // 기록을 다 못 받은 진입은 판단하지 않는다 — 오프라인으로 켠 홈이 0 을 기억하면 연결된 뒤 같은 날 불꽃이 또 떴다(11/2 폰 QA).
  if (input.failed) return { celebrate: false, remember: null };
  // 같은 날 이미 본 값보다 작게 세였다면(잠깐 덜 받은 기록) 기억을 낮추지 않는다. 날이 바뀌면 끊긴 연속을 그대로 적는다.
  const sameDay = !!input.lastSeenDay && input.lastSeenDay === input.today;
  if (sameDay && input.current < input.lastSeen) return { celebrate: false, remember: null };
  return {
    // 축하는 "오늘 연습해서 늘었을 때"만 한다. 앱을 새로 깔았거나 저장값이 지워져 '마지막으로 본 값'이
    // 0 으로 돌아가도, 오늘 연습이 없으면 어제까지의 연속일로 불꽃을 다시 띄우지 않는다(실기기, 11/2).
    celebrate: input.practicedToday && shouldCelebrateStreak(input.lastSeen, input.current),
    remember: Math.max(0, Math.trunc(input.current)),
  };
}
