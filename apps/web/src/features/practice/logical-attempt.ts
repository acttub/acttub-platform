export type LogicalAttempt<T> = {
  requestId: string;
  context: T;
};

export type LogicalAttemptRegistry = ReturnType<typeof createLogicalAttemptRegistry>;

export function createLogicalAttemptRegistry(
  createRequestId: () => string = () => crypto.randomUUID(),
) {
  const attempts = new Map<string, LogicalAttempt<unknown>>();

  return {
    acquire<T>(key: string, createContext: () => T): LogicalAttempt<T> {
      const current = attempts.get(key);
      if (current) return current as LogicalAttempt<T>;

      const attempt = { requestId: createRequestId(), context: createContext() };
      attempts.set(key, attempt);
      return attempt;
    },

    peek<T>(key: string): LogicalAttempt<T> | null {
      return (attempts.get(key) as LogicalAttempt<T> | undefined) ?? null;
    },

    settle(key: string, requestId: string): boolean {
      if (attempts.get(key)?.requestId !== requestId) return false;
      return attempts.delete(key);
    },
  };
}

export async function reconcilePersistedMutation<T>(
  sessionId: string,
  _reason: unknown,
  readPersisted: (sessionId: string) => Promise<T>,
  acceptPersisted: (session: T) => void,
): Promise<boolean> {
  try {
    acceptPersisted(await readPersisted(sessionId));
    return true;
  } catch {
    return false;
  }
}
