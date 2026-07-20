export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function abortError(signal?: AbortSignal): DOMException {
  const error = new DOMException("영상 준비가 취소되었어요.", "AbortError");
  if (signal?.reason !== undefined) {
    Object.defineProperty(error, "cause", { value: signal.reason });
  }
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}
