/**
 * 로그인 없이 둘러보기(게스트) 플래그 — 기기에만 남는다.
 *
 * 게스트는 서버 계정이 없다. 홈·대본 리딩(기기 저장)·챌린지 예시·보관함처럼 서버가 필요 없는
 * 화면만 쓰고, AI 코칭·업로드·프로필처럼 계정이 있어야 하는 자리는 로그인으로 보낸다.
 * (CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 lazy require.)
 */

const KEY = 'acttub.guest';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function isGuestFlagSet(): Promise<boolean> {
  try {
    return (await storage().getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setGuestFlag(on: boolean): Promise<void> {
  try {
    if (on) await storage().setItem(KEY, '1');
    else await storage().removeItem(KEY);
  } catch {
    // 못 적어도 이번 세션은 상태로 굴러간다
  }
}
