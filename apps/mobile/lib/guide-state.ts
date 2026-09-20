/** 첫 시작 가이드(4장)를 봤는지 — 기기에 한 번만 기록한다. 설정 "가이드 다시 보기"로 언제든 다시 연다. */

const KEY = 'acttub.guide.seen';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function hasSeenGuide(): Promise<boolean> {
  try {
    return (await storage().getItem(KEY)) === '1';
  } catch {
    return true; // 못 읽으면 본 것으로 — 매번 뜨는 쪽이 더 나쁘다
  }
}

export async function markGuideSeen(): Promise<void> {
  try {
    await storage().setItem(KEY, '1');
  } catch {
    // no-op
  }
}
