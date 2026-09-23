/** 리딩 가이드(R03.0)는 기기당 처음 한 번 보여 준다. 플래그는 기기 저장소에 둔다(reading.session). */
export const GUIDE_SEEN_KEY = 'acttub.reading.guideSeen';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function defaultStorage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function hasSeenReadingGuide(storage: Storage = defaultStorage()): Promise<boolean> {
  try {
    return (await storage.getItem(GUIDE_SEEN_KEY)) === '1';
  } catch {
    return true; // 못 읽으면 본 것으로 — 매번 뜨는 쪽이 더 나쁘다
  }
}

export async function markReadingGuideSeen(storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(GUIDE_SEEN_KEY, '1');
  } catch {
    // no-op
  }
}
