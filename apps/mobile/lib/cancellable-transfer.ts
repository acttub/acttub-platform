export type CancellableCompressionDependencies<T extends { uri: string }> = {
  originalUri: string;
  run: (onCancellationId: (id: string) => void) => Promise<T>;
  cancelNative: (id: string) => void | Promise<void>;
  removeOutput: (uri: string) => Promise<void>;
};

export type CancellableCompressionResult<T extends { uri: string }> =
  | { kind: 'completed'; value: T }
  | { kind: 'cancelled' };

export function startCancellableCompression<T extends { uri: string }>(
  dependencies: CancellableCompressionDependencies<T>,
): {
  result: Promise<CancellableCompressionResult<T>>;
  cancel: () => Promise<void>;
} {
  let cancelled = false;
  let cancellationId: string | null = null;
  let runSettled = false;
  let resolveCancellationId: (id: string) => void;
  const cancellationIdReady = new Promise<string>((resolve) => {
    resolveCancellationId = resolve;
  });
  const nativeCancellations = new Map<string, Promise<void>>();

  const cancelId = (id: string): Promise<void> => {
    const existing = nativeCancellations.get(id);
    if (existing) return existing;
    const pending = (async () => {
      try {
        await dependencies.cancelNative(id);
      } catch {
        // native task가 이미 끝난 race여도 local cancellation 상태는 유지한다.
      }
    })();
    nativeCancellations.set(id, pending);
    return pending;
  };

  const onCancellationId = (id: string) => {
    cancellationId = id;
    resolveCancellationId(id);
    if (cancelled) void cancelId(id);
  };

  const result = (async (): Promise<CancellableCompressionResult<T>> => {
    try {
      let value: T;
      try {
        value = await dependencies.run(onCancellationId);
      } catch (error) {
        if (cancelled) return { kind: 'cancelled' };
        throw error;
      }
      if (!cancelled) return { kind: 'completed', value };
      if (value.uri !== dependencies.originalUri) {
        await dependencies.removeOutput(value.uri).catch(() => undefined);
      }
      return { kind: 'cancelled' };
    } finally {
      runSettled = true;
    }
  })();
  const resultSettled = result.then(
    () => undefined,
    () => undefined,
  );

  return {
    result,
    cancel: async () => {
      cancelled = true;
      if (runSettled) return;
      if (cancellationId) {
        await cancelId(cancellationId);
        return;
      }
      const outcome = await Promise.race([
        cancellationIdReady.then((id) => ({ kind: 'id' as const, id })),
        resultSettled.then(() => ({ kind: 'settled' as const })),
      ]);
      if (outcome.kind === 'id') await cancelId(outcome.id);
    },
  };
}
