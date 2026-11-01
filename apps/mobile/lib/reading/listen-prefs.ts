/**
 * 리딩 듣기 설정(앱 1.1.1, SOMA-952·954) — 배역 고르기 화면에서 고르고 이 기기에 남긴다.
 * - handsFree: 내 차례에 말하지 않아도 대사 길이만큼 쉬고 넘어간다. 마이크를 열지 않는다(회차 advance 'timed').
 * - rate: 상대 대사(앱이 읽는 모든 목소리)의 재생 속도. 핸즈프리의 쉬는 시간도 같은 비율로 줄고 늘어난다.
 * 내 배역을 하나도 고르지 않으면 「전체 듣기」다 — 이 설정과 따로, 회차의 내 배역이 비어 있는 것으로 안다.
 */
export const LISTEN_PREFS_KEY = 'acttub.reading.listenPrefs';

export const READING_RATES = [0.8, 1, 1.2, 1.5] as const;
export type ReadingRate = (typeof READING_RATES)[number];

export type ListenPrefs = { handsFree: boolean; rate: ReadingRate };
export const DEFAULT_LISTEN_PREFS: ListenPrefs = { handsFree: false, rate: 1 };

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

export async function loadListenPrefs(storage: Storage = defaultStorage()): Promise<ListenPrefs> {
  try {
    const raw = await storage.getItem(LISTEN_PREFS_KEY);
    if (!raw) return DEFAULT_LISTEN_PREFS;
    const parsed = JSON.parse(raw) as Partial<ListenPrefs>;
    return { handsFree: parsed.handsFree === true, rate: normalizeRate(parsed.rate) };
  } catch {
    return DEFAULT_LISTEN_PREFS;
  }
}

export async function saveListenPrefs(prefs: ListenPrefs, storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(LISTEN_PREFS_KEY, JSON.stringify({ handsFree: prefs.handsFree, rate: normalizeRate(prefs.rate) }));
  } catch {
    // 못 남겨도 이번 회차는 고른 대로 간다.
  }
}

/** 속도 칸의 숫자 — 「1」「1.2」. 단위(배·x)는 번역 키 reading.rateValue 가 붙인다. */
export function rateLabel(rate: number): string {
  return Number.isInteger(rate) ? rate.toFixed(0) : String(rate);
}

/** 한 글자를 말하는 데 드는 대략의 시간(한국어 낭독 초당 약 6~7음절). 공백·문장부호는 세지 않는다. */
export const PAUSE_MS_PER_CHAR = 160;
/** 말을 떠올리고 시작하는 여유. */
export const PAUSE_BASE_MS = 1_000;
export const PAUSE_MIN_MS = 1_500;
export const PAUSE_MAX_MS = 20_000;

/**
 * 핸즈프리에서 내 차례에 쉬는 시간 — 대사 길이에 맞춘다(긴 대사는 길게, 짧은 대사는 짧게). 속도를 올리면 그만큼 짧아진다.
 * 지문 괄호 안은 말하지 않으므로 뺀다.
 */
export function pauseMsFor(text: string, rate: number = 1): number {
  const spoken = (text ?? '').replace(/[(（][^)）]*[)）]/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
  const raw = PAUSE_BASE_MS + spoken.length * PAUSE_MS_PER_CHAR;
  const scaled = raw / (rate > 0 ? rate : 1);
  return Math.round(Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, scaled)));
}
