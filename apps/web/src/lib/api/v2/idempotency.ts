import { apiFetch, type ApiResponse } from "./client";
import { isRateLimited, isStillProcessing, NetworkError } from "./errors";

export type RetryWaitReason = "processing" | "rate_limited" | "network";

export type PostIdempotentOptions = {
  requestId?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  onWait?: (info: {
    reason: RetryWaitReason;
    attempt: number;
    delayMs: number;
  }) => void;
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function deadlineError(): DOMException {
  return new DOMException("멱등 요청 처리 기한을 초과했습니다.", "TimeoutError");
}

function signalUntilDeadline(
  source: AbortSignal | undefined,
  remainingMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortReason(source as AbortSignal));

  if (source?.aborted) {
    onAbort();
  } else {
    source?.addEventListener("abort", onAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(deadlineError()), remainingMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      source?.removeEventListener("abort", onAbort);
    },
  };
}

export async function postIdempotent<T>(
  path: string,
  body: unknown,
  options: PostIdempotentOptions = {},
): Promise<ApiResponse<T>> {
  const requestId = options.requestId ?? newRequestId();
  const deadlineMs = options.deadlineMs ?? 120_000;
  const deadline = Date.now() + deadlineMs;
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  let processingAttempts = 0;
  let rateLimitAttempts = 0;
  let networkAttempts = 0;
  let lastError: unknown;

  while (true) {
    const requestRemainingMs = deadline - Date.now();
    if (requestRemainingMs <= 0) {
      if (lastError !== undefined) throw lastError;
      throw deadlineError();
    }

    try {
      const attempt = signalUntilDeadline(options.signal, requestRemainingMs);
      try {
        return await apiFetch<T>(path, {
          method: "POST",
          body: serializedBody,
          headers: { "X-Request-Id": requestId },
          signal: attempt.signal,
        });
      } finally {
        attempt.cleanup();
      }
    } catch (error) {
      lastError = error;
      let reason: RetryWaitReason;
      let attempt: number;
      let delayMs: number;

      if (isStillProcessing(error)) {
        reason = "processing";
        attempt = ++processingAttempts;
        delayMs = Math.min(10_000, 2_000 * 1.5 ** (attempt - 1));
      } else if (isRateLimited(error) && rateLimitAttempts < 4) {
        reason = "rate_limited";
        attempt = ++rateLimitAttempts;
        delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1)) + Math.random() * 500;
      } else if (error instanceof NetworkError && networkAttempts < 3) {
        reason = "network";
        attempt = ++networkAttempts;
        delayMs = 1_000 * 2 ** (attempt - 1);
      } else {
        throw error;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw error;
      const boundedDelayMs = Math.min(delayMs, remainingMs);
      options.onWait?.({ reason, attempt, delayMs: boundedDelayMs });
      await wait(boundedDelayMs, options.signal);
    }
  }
}
