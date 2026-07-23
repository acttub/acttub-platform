export type CredentialUser = {
  id: string;
  email: string | null;
  status: 'active' | 'suspended';
};

export type CredentialRecord = {
  schemaVersion: number;
  accessToken: string;
  refreshToken: string;
  user: CredentialUser;
};

export type CredentialPersistence = {
  load: () => Promise<CredentialRecord | null>;
  save: (
    accessToken: string,
    refreshToken: string,
    user: CredentialUser,
  ) => Promise<CredentialRecord>;
  saveRefreshed: (
    accessToken: string,
    refreshToken: string,
    currentUser: CredentialUser,
  ) => Promise<CredentialRecord>;
  clear: () => Promise<void>;
};

export type CredentialExpectation = {
  authSessionEpoch: number;
  refreshToken: string | null;
};

export type RefreshCommitResult =
  | 'refreshed'
  | 'principal_changed'
  | 'stale';

type Listener = () => void;
type UserListener = (user: CredentialUser) => void;

/**
 * 인증 credential의 메모리 공개와 persistence 변경을 하나의 FIFO queue로 직렬화한다.
 * login·clear는 호출 시점에 session boundary를 예약해 실행 중인 refresh도 즉시 stale로 만든다.
 */
export function createCredentialMutationQueue(
  persistence: CredentialPersistence,
) {
  let credential: CredentialRecord | null = null;
  let loaded = false;
  let authSessionEpoch = 0;
  let requestedGeneration = 0;
  let committedGeneration = 0;
  let mutationTail: Promise<void> = Promise.resolve();

  const clearedListeners = new Set<Listener>();
  const storedUserChangedListeners = new Set<UserListener>();

  function enqueue<T>(mutation: () => Promise<T>): Promise<T> {
    const queued = mutationTail.then(mutation, mutation);
    mutationTail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  function visibleCredential(): CredentialRecord | null {
    return requestedGeneration === committedGeneration ? credential : null;
  }

  function matches(expectation: CredentialExpectation): boolean {
    return (
      authSessionEpoch === expectation.authSessionEpoch &&
      (visibleCredential()?.refreshToken ?? null) === expectation.refreshToken
    );
  }

  function reserveAuthSessionBoundary(): number {
    requestedGeneration += 1;
    authSessionEpoch += 1;
    return requestedGeneration;
  }

  async function loadTokens(): Promise<boolean> {
    if (loaded) return visibleCredential() !== null;
    const expectedGeneration = requestedGeneration;
    return enqueue(async () => {
      if (loaded) return visibleCredential() !== null;
      let restored: CredentialRecord | null;
      try {
        restored = await persistence.load();
      } catch {
        restored = null;
      }
      if (expectedGeneration !== requestedGeneration) return false;
      credential = restored;
      committedGeneration = expectedGeneration;
      loaded = true;
      return restored !== null;
    });
  }

  function getAccessToken(): string | null {
    return visibleCredential()?.accessToken ?? null;
  }

  function getRefreshToken(): string | null {
    return visibleCredential()?.refreshToken ?? null;
  }

  function getStoredUser(): CredentialUser | null {
    return visibleCredential()?.user ?? null;
  }

  function getAuthSessionEpoch(): number {
    return authSessionEpoch;
  }

  function onTokensCleared(listener: Listener): () => void {
    clearedListeners.add(listener);
    return () => clearedListeners.delete(listener);
  }

  function onStoredUserChanged(listener: UserListener): () => void {
    storedUserChangedListeners.add(listener);
    return () => storedUserChangedListeners.delete(listener);
  }

  function setLoginTokens(
    accessToken: string,
    refreshToken: string,
    user: CredentialUser,
  ): Promise<boolean> {
    const generation = reserveAuthSessionBoundary();
    return enqueue(async () => {
      if (generation !== requestedGeneration) return false;
      const saved = await persistence.save(accessToken, refreshToken, user);
      if (generation !== requestedGeneration) {
        await persistence.clear();
        return false;
      }
      credential = saved;
      committedGeneration = generation;
      loaded = true;
      return true;
    });
  }

  function commitRefresh(
    accessToken: string,
    refreshToken: string,
    expectation: CredentialExpectation,
  ): Promise<RefreshCommitResult> {
    return enqueue(async () => {
      if (!matches(expectation)) return 'stale';
      const current = visibleCredential();
      if (!current) return 'stale';

      const saved = await persistence.saveRefreshed(
        accessToken,
        refreshToken,
        current.user,
      );
      if (!matches(expectation)) {
        await persistence.clear();
        return 'stale';
      }

      const principalChanged = current.user.id !== saved.user.id;
      if (principalChanged) {
        authSessionEpoch += 1;
        requestedGeneration += 1;
        committedGeneration = requestedGeneration;
      }
      credential = saved;
      loaded = true;

      if (principalChanged) {
        for (const listener of storedUserChangedListeners) listener(saved.user);
        return 'principal_changed';
      }
      return 'refreshed';
    });
  }

  function clearTokens(): Promise<boolean> {
    const generation = reserveAuthSessionBoundary();
    return enqueue(async () => {
      try {
        await persistence.clear();
      } catch {
        // persistence 삭제 실패와 관계없이 최신 generation의 메모리 세션은 비운다.
      }
      if (generation !== requestedGeneration) return false;
      credential = null;
      committedGeneration = generation;
      loaded = true;
      for (const listener of clearedListeners) listener();
      return true;
    });
  }

  function clearTokensIfCurrent(
    expectation: CredentialExpectation,
  ): Promise<boolean> {
    if (!matches(expectation)) return Promise.resolve(false);
    return clearTokens();
  }

  return {
    loadTokens,
    getAccessToken,
    getRefreshToken,
    getStoredUser,
    getAuthSessionEpoch,
    onTokensCleared,
    onStoredUserChanged,
    setLoginTokens,
    commitRefresh,
    clearTokens,
    clearTokensIfCurrent,
  };
}
