import { isLoginProvider, type LoginProvider } from './login-flow.ts';

/**
 * 마지막에 쓴 로그인 제공자 — 이 폰에만 기억한다(account.login). 서버는 관여하지 않는다.
 *
 * 로그아웃해도 남고, 앱을 지우면 사라진다. 그래서 계정 자료를 쓸어 내는 `acttub.` 접두사
 * (local-account-data) 밖에 둔다. 탈퇴처럼 계정이 사라질 때는 forget을 직접 부른다.
 */
const KEY = 'device.lastLoginProvider';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createLastProviderStore(storage: Storage) {
  return {
    async read(): Promise<LoginProvider | null> {
      try {
        const value = await storage.getItem(KEY);
        return isLoginProvider(value) ? value : null;
      } catch {
        return null;
      }
    },
    /** 강조는 부가 기능이라 저장에 실패해도 로그인을 막지 않는다. */
    async remember(provider: LoginProvider): Promise<void> {
      try {
        await storage.setItem(KEY, provider);
      } catch {
        // 다음 로그인 화면에 강조가 없을 뿐이다.
      }
    },
    async forget(): Promise<void> {
      try {
        await storage.removeItem(KEY);
      } catch {
        // 이미 없으면 그걸로 됐다.
      }
    },
  };
}

// CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 함수 안에서 lazy require.
function deviceStorage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

const lazyStorage: Storage = {
  getItem: (key) => deviceStorage().getItem(key),
  setItem: (key, value) => deviceStorage().setItem(key, value),
  removeItem: (key) => deviceStorage().removeItem(key),
};

export const lastProviderStore = createLastProviderStore(lazyStorage);
