import { apiFetch, type ApiResponse } from "./client";
import { consentPromptElapsedMs, whenConsentPromptCloses } from "./consent-prompt";
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

function newRequestId(): string {
  // crypto.randomUUID는 보안 컨텍스트(HTTPS·localhost) 전용이라
  // http://<IP> 배포에서는 getRandomValues 기반 UUID v4로 폴백한다.
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" + hex.slice(4, 6).join("") +
    "-" + hex.slice(6, 8).join("") +
    "-" + hex.slice(8, 10).join("") +
    "-" + hex.slice(10, 16).join("")
  );
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

/**
 * @param remainingMs 지금 남은 기한. 동의 시트가 떠 있던 시간은 세지 않으므로 타이머가 울린
 *   시점에도 기한이 남아 있을 수 있다 — 그때마다 다시 물어 맞춘다.
 */
function signalUntilDeadline(
  source: AbortSignal | undefined,
  remainingMs: () => number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortReason(source as AbortSignal));

  if (source?.aborted) {
    onAbort();
  } else {
    source?.addEventListener("abort", onAbort, { once: true });
  }

  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    timer = setTimeout(onTimer, Math.max(0, remainingMs()));
  };
  const onTimer = () => {
    if (finished) return;
    // 시트가 열려 있는 동안 기한은 멈춰 있다. 닫힌 뒤에 남은 만큼 다시 잰다.
    const sheetCloses = whenConsentPromptCloses();
    if (sheetCloses) {
      void sheetCloses.then(() => {
        if (!finished) arm();
      });
      return;
    }
    if (remainingMs() > 0) {
      arm();
      return;
    }
    controller.abort(deadlineError());
  };
  arm();

  return {
    signal: controller.signal,
    cleanup: () => {
      finished = true;
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
  // 기한은 서버를 기다린 시간만 센다. 동의 시트가 떠 있던 시간(배우가 문서를 읽는 시간)은
  // 뺀다 — 세면 동의를 마치자마자 보낸 재전송이 TimeoutError 로 죽는다.
  const startedAt = Date.now();
  const sheetMsAtStart = consentPromptElapsedMs(startedAt);
  const remainingMs = () => {
    const now = Date.now();
    const sheetMs = consentPromptElapsedMs(now) - sheetMsAtStart;
    return deadlineMs - (now - startedAt - sheetMs);
  };
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  let processingAttempts = 0;
  let rateLimitAttempts = 0;
  let networkAttempts = 0;
  let lastError: unknown;

  while (true) {
    if (remainingMs() <= 0) {
      if (lastError !== undefined) throw lastError;
      throw deadlineError();
    }

    try {
      const attempt = signalUntilDeadline(options.signal, remainingMs);
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

      const leftMs = remainingMs();
      if (leftMs <= 0) throw error;
      const boundedDelayMs = Math.min(delayMs, leftMs);
      options.onWait?.({ reason, attempt, delayMs: boundedDelayMs });
      await wait(boundedDelayMs, options.signal);
    }
  }
}
