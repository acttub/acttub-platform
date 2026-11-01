/**
 * 리딩 듣기 설정(앱 1.1.1, SOMA-952·954) — 배역 고르기 화면에서 고르고 이 기기에 남긴다.
 * - handsFree: 「자동 넘김」 — 내 차례에 말하지 않아도 정한 시간(pauseSec)만큼 쉬고 넘어간다. 마이크를 열지 않는다
 *   (회차 advance 'timed'). 켜면 쉬는 시간을 고를 수 있고 기본 2초다(11/1 사용자 결정).
 * - rate: 상대 대사(앱이 읽는 모든 목소리)의 재생 속도.
 * 내 배역을 하나도 고르지 않으면 「전체 듣기」다 — 이 설정과 따로, 회차의 내 배역이 비어 있는 것으로 안다.
 */
export const LISTEN_PREFS_KEY = 'acttub.reading.listenPrefs';

export const READING_RATES = [0.8, 1, 1.2, 1.5] as const;
export type ReadingRate = (typeof READING_RATES)[number];

/** 자동 넘김에서 내 차례에 쉬는 시간(초). */
export const PAUSE_SECONDS = [1, 2, 3, 5] as const;
export type PauseSeconds = (typeof PAUSE_SECONDS)[number];

export type ListenPrefs = { handsFree: boolean; rate: ReadingRate; pauseSec: PauseSeconds };
export const DEFAULT_LISTEN_PREFS: ListenPrefs = { handsFree: false, rate: 1, pauseSec: 2 };

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function defaultStorage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export function normalizeRate(value: unknown): ReadingRate {
  return (READING_RATES as readonly number[]).includes(value as number) ? (value as ReadingRate) : 1;
}

export function normalizePause(value: unknown): PauseSeconds {
  return (PAUSE_SECONDS as readonly number[]).includes(value as number) ? (value as PauseSeconds) : DEFAULT_LISTEN_PREFS.pauseSec;
}

export async function loadListenPrefs(storage: Storage = defaultStorage()): Promise<ListenPrefs> {
  try {
    const raw = await storage.getItem(LISTEN_PREFS_KEY);
    if (!raw) return DEFAULT_LISTEN_PREFS;
    const parsed = JSON.parse(raw) as Partial<ListenPrefs>;
    return { handsFree: parsed.handsFree === true, rate: normalizeRate(parsed.rate), pauseSec: normalizePause(parsed.pauseSec) };
  } catch {
    return DEFAULT_LISTEN_PREFS;
  }
}

export async function saveListenPrefs(prefs: ListenPrefs, storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(LISTEN_PREFS_KEY, JSON.stringify({ handsFree: prefs.handsFree, rate: normalizeRate(prefs.rate), pauseSec: normalizePause(prefs.pauseSec) }));
  } catch {
    // 못 남겨도 이번 회차는 고른 대로 간다.
  }
}

/** 속도 칸의 숫자 — 「1」「1.2」. 단위(배·x)는 번역 키 reading.rateValue 가 붙인다. */
export function rateLabel(rate: number): string {
  return Number.isInteger(rate) ? rate.toFixed(0) : String(rate);
}

/** 자동 넘김에서 내 차례에 쉬는 시간(ms) — 고른 초 그대로다. 읽는 속도와 상관없다. */
export function pauseMsFor(pauseSec: number): number {
  return normalizePause(pauseSec) * 1000;
}
