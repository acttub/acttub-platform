import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 듀오링고식 연속일 축하 (SOMA-479).
 *
 * 홈에 들어올 때마다 "오늘 연습으로 연속일이 늘었나"를 본다. 늘었으면 딱 한 번
 * 축하하고, 방금 본 연속일을 저장해 둔다. 같은 값으로 다시 들어오면 조용하다.
 * 연속이 끊겨 줄어든 경우도 저장만 갱신하고 축하하지 않는다.
 *
 * 판정은 순수 함수라 node 테스트로 잠근다(RN·저장소에 안 기댄다).
 */

const LAST_SEEN_KEY = 'acttub.streak.lastSeen';

/** 지금 연속일이 마지막으로 본 값보다 크면(=오늘 늘었으면) 축하한다. */
export function shouldCelebrateStreak(lastSeen: number, current: number): boolean {
  if (!Number.isFinite(current) || current < 1) return false;
  const seen = Number.isFinite(lastSeen) ? lastSeen : 0;
  return current > seen;
}

/** 저장된 '마지막으로 본 연속일'. 없거나 깨졌으면 0. */
export async function readLastSeenStreak(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    // 저장소를 못 읽으면 0으로 본다 — 최악은 축하가 한 번 더 뜨는 것뿐이다.
    return 0;
  }
}

/** 방금 본 연속일을 저장한다. 실패해도 조용히 넘어간다(축하는 곁다리 기능이다). */
export async function writeLastSeenStreak(current: number): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SEEN_KEY, String(Math.max(0, Math.trunc(current))));
  } catch {
    // 무시 — 다음 진입에서 다시 시도된다.
  }
}
