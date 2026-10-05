/**
 * 자동 넘김 안내 팝업(R9.8 「말이 끝나면 저절로 넘어가요」, reading.session)은 회차를 시작할 때마다 뜨고
 * [다시 보지 않기]를 누르면 이 기기에서 다시 뜨지 않는다. 설정의 「가이드 다시 보기」가 이 표시를 지운다(guide-state).
 */
export const AUTO_ADVANCE_TIP_KEY = 'acttub.reading.autoAdvanceTipHidden';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function defaultStorage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function isAutoAdvanceTipHidden(storage: Storage = defaultStorage()): Promise<boolean> {
  try {
    return (await storage.getItem(AUTO_ADVANCE_TIP_KEY)) === '1';
  } catch {
    return true; // 못 읽으면 숨긴 것으로 — 매번 뜨는 쪽이 더 나쁘다
  }
}

export async function hideAutoAdvanceTip(storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(AUTO_ADVANCE_TIP_KEY, '1');
  } catch {
    // no-op
  }
}
