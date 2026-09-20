/**
 * 이 폰의 푸시 토큰이 서버에 살고 죽는 순서(account.notification · account.logout).
 *
 * - 등록은 보호 기능이라 게이트를 통과한 뒤와 앱을 열 때 한다.
 * - 삭제는 로그인 없이 받는다(토큰 소지가 본인 확인). 그래서 로그아웃 때 실패한 삭제를
 *   기기에 적어 두었다가 다음 실행 때 다시 보낼 수 있다.
 * - 새 로그인으로 등록에 성공하면 밀린 삭제를 버린다. 순서가 뒤집혀 새 회원의 등록을
 *   지우지 않기 위해서다. 같은 이유로 모든 동작을 한 줄로 세워 서로 끼어들지 않게 한다.
 *
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(notifications.ts 가 저장소와 API 를 넣어 쓴다).
 */
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type PushTokenApi = {
  register: (token: string, platform: 'ios' | 'android') => Promise<void>;
  /** 로그인 없이 보낸다. 없는 토큰이어도 204다(멱등). */
  unregister: (token: string) => Promise<void>;
};

/** 'acttub.' 접두사 — 탈퇴 시 local-account-data 가 이 접두사를 통째로 지운다. */
const TOKEN_KEY = 'acttub.push.token';
/**
 * 밀린 삭제는 접두사 밖에 둔다. 로그아웃으로 계정 캐시를 지운 뒤에도 남아 있어야 다음
 * 실행 때 다시 보낼 수 있다.
 */
const PENDING_KEY = 'device.pendingPushTokenDeletions';

export function createPushTokenLifecycle(dependencies: { storage: Storage; api: PushTokenApi }) {
  const { storage, api } = dependencies;
  let tail: Promise<unknown> = Promise.resolve();

  /** 앞선 동작이 끝난 뒤에 돈다. 앞이 실패했어도 뒤는 간다. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  async function readPending(): Promise<string[]> {
    try {
      const raw = await storage.getItem(PENDING_KEY);
      if (!raw) return [];
      const value = JSON.parse(raw) as unknown;
      return Array.isArray(value)
        ? value.filter((token): token is string => typeof token === 'string' && token.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  async function writePending(tokens: string[]): Promise<void> {
    try {
      if (tokens.length === 0) await storage.removeItem(PENDING_KEY);
      else await storage.setItem(PENDING_KEY, JSON.stringify([...new Set(tokens)]));
    } catch {
      // 적어 두지 못하면 재시도가 없을 뿐이다. 다음 사람의 등록이 토큰의 주인을 바꾼다.
    }
  }

  async function readToken(): Promise<string | null> {
    try {
      return await storage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  return {
    currentToken: readToken,
    pendingDeletions: readPending,

    /**
     * 이 폰의 토큰을 내 것으로 등록한다. 실패하면 던진다(부르는 쪽이 최선 노력으로 삼킨다).
     *
     * 줄에서 차례가 왔을 때 계정이 이미 떠났으면(isCurrent 가 거짓) 등록하지 않는다. 로그아웃의
     * 토큰 삭제 뒤에도 액세스 토큰은 잠시 기기에 남아 있어, 늦게 도착한 등록을 서버가 받아 준다.
     */
    register(
      token: string,
      platform: 'ios' | 'android',
      isCurrent: () => boolean = () => true,
    ): Promise<void> {
      return enqueue(async () => {
        if (!isCurrent()) return;
        await api.register(token, platform);
        await storage.setItem(TOKEN_KEY, token);
        await writePending([]);
      });
    },

    /**
     * 로그아웃의 첫 단계. 서버에서 이 폰의 토큰을 지운다. 실패해도 던지지 않고 기기에 적어
     * 둔다 — 로그아웃은 계속 가고, 그동안 옛 계정의 알림이 올 수 있다.
     */
    detach(): Promise<void> {
      return enqueue(async () => {
        const token = await readToken();
        if (!token) return;
        await storage.removeItem(TOKEN_KEY).catch(() => undefined);
        try {
          await api.unregister(token);
        } catch {
          await writePending([...(await readPending()), token]);
        }
      });
    },

    /** 서버가 이미 지웠다(푸시 토글 둘 다 끔, 탈퇴). 기기의 기록만 버린다. */
    forget(): Promise<void> {
      return enqueue(async () => {
        await storage.removeItem(TOKEN_KEY).catch(() => undefined);
      });
    },

    /** 앱을 열 때 부른다. 밀린 삭제를 로그인 없이 다시 보내고, 지운 것만 목록에서 뺀다. */
    flushPending(): Promise<void> {
      return enqueue(async () => {
        const pending = await readPending();
        if (pending.length === 0) return;
        const remaining: string[] = [];
        for (const token of pending) {
          try {
            await api.unregister(token);
          } catch {
            remaining.push(token);
          }
        }
        await writePending(remaining);
      });
    },
  };
}
