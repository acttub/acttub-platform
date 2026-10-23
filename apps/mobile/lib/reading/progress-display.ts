import type { SessionCard, SessionProgress } from './types.ts';

/**
 * 홈 리딩 카드의 진행 표시. 서버는 인식된 말이 없이 끝까지 넘긴 회차를 완료로 받지 않아(SOMA-773) 열린 채
 * 마지막 대사 직전(9/10)에 둔다. 사용자가 끝 줄까지 갔다고 이 기기에 남긴 표시가 있으면 N/N 으로 보인다.
 */
export const REACHED_END_KEY = 'acttub.reading.reachedEnd';
const KEEP = 30;
export const DEFAULT_SEC_PER_LINE = 4;

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function defaultStorage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

async function readIds(storage: Storage): Promise<string[]> {
  try {
    const raw = await storage.getItem(REACHED_END_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function markReachedEnd(sessionId: string, storage: Storage = defaultStorage()): Promise<void> {
  try {
    const ids = (await readIds(storage)).filter((id) => id !== sessionId);
    await storage.setItem(REACHED_END_KEY, JSON.stringify([...ids, sessionId].slice(-KEEP)));
  } catch {
    // 표시만 못 남길 뿐이다.
  }
}

export async function clearReachedEnd(sessionId: string, storage: Storage = defaultStorage()): Promise<void> {
  try {
    const ids = await readIds(storage);
    if (ids.includes(sessionId)) await storage.setItem(REACHED_END_KEY, JSON.stringify(ids.filter((id) => id !== sessionId)));
  } catch {
    // 무시
  }
}

export async function hasReachedEnd(sessionId: string, storage: Storage = defaultStorage()): Promise<boolean> {
  return (await readIds(storage)).includes(sessionId);
}

/** 끝 줄까지 갔다고 남긴 회차면 done 을 total 로 올린다. */
export function displayProgress(progress: SessionProgress, reachedEnd: boolean): SessionProgress {
  return reachedEnd && progress.total > 0 ? { done: progress.total, total: progress.total } : progress;
}

/** 줄당 평균 초 — 끝난 회차의 (걸린 초 ÷ 구간 대사 수) 평균. 기록이 없으면 4초. */
export function secPerLine(sessions: readonly Pick<SessionCard, 'status' | 'range' | 'elapsed_seconds'>[]): number {
  const rates: number[] = [];
  for (const s of sessions) {
    if (s.status !== 'completed' || s.elapsed_seconds <= 0) continue;
    const lines = s.range.end_dialogue_no - s.range.start_dialogue_no + 1;
    if (lines > 0) rates.push(s.elapsed_seconds / lines);
  }
  if (rates.length === 0) return DEFAULT_SEC_PER_LINE;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

/** 남은 시간(분, 올림, 최소 1). 다 읽었으면 null. */
export function remainingMinutes(progress: SessionProgress, perLine: number): number | null {
  const left = progress.total - progress.done;
  if (left <= 0) return null;
  return Math.max(1, Math.ceil((left * perLine) / 60));
}
