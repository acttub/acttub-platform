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
  const cancelledIds = new Set<string>();

  const cancelId = async (id: string): Promise<void> => {
    if (cancelledIds.has(id)) return;
    cancelledIds.add(id);
    try {
      await dependencies.cancelNative(id);
    } catch {
      // native task가 이미 끝난 race여도 local cancellation 상태는 유지한다.
    }
  };

  const onCancellationId = (id: string) => {
    cancellationId = id;
    if (cancelled) void cancelId(id);
  };

  const result = (async (): Promise<CancellableCompressionResult<T>> => {
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
  })();

  return {
    result,
    cancel: async () => {
      cancelled = true;
      if (cancellationId) await cancelId(cancellationId);
    },
  };
}
