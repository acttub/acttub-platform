import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 새 연습 권리 체크를 기억한다(SOMA-984). 한 번 동의하고 코칭을 시작했으면 이 기기·이 계정에서는 다음부터 체크된 채로 연다.
 * 체크 줄은 그대로 보이므로 배우가 언제든 끌 수 있다. 못 읽으면 체크하지 않은 것으로 둔다(동의를 지어내지 않는다).
 */
export const RIGHTS_AGREED_KEY = 'acttub.practice.rightsAgreed';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function defaultStorage(): Storage {
  return AsyncStorage;
}

function keyFor(userId: string): string {
  return `${RIGHTS_AGREED_KEY}:${userId}`;
}

export async function hasAgreedRights(userId: string | null | undefined, storage: Storage = defaultStorage()): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await storage.getItem(keyFor(userId))) === '1';
  } catch {
    return false;
  }
}

export async function rememberAgreedRights(userId: string | null | undefined, storage: Storage = defaultStorage()): Promise<void> {
  if (!userId) return;
  try {
    await storage.setItem(keyFor(userId), '1');
  } catch {
    // 못 쓰면 다음에 다시 체크하면 된다.
  }
}
