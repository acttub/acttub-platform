import { apiFetch, type ApiResponse } from "./client";
import { consentPromptElapsedMs, whenConsentPromptCloses } from "./consent-prompt";
import { ApiError, isRateLimited, isStillProcessing, NetworkError, toApiError } from "./errors";
import { consumeCoachStream, streamFailureAction } from "./coach-stream";
import { newRequestId } from "../../reading/request-id";

export type PostIdempotentOptions = {
  requestId?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
};

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

export function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
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
      let delayMs: number;

      if (isStillProcessing(error)) {
        delayMs = Math.min(10_000, 2_000 * 1.5 ** processingAttempts++);
      } else if (isRateLimited(error) && rateLimitAttempts < 4) {
        delayMs = Math.min(30_000, 2_000 * 2 ** rateLimitAttempts++) + Math.random() * 500;
      } else if (error instanceof NetworkError && networkAttempts < 3) {
        delayMs = 1_000 * 2 ** networkAttempts++;
      } else {
        throw error;
      }

      const leftMs = remainingMs();
      if (leftMs <= 0) throw error;
      await wait(Math.min(delayMs, leftMs), options.signal);
    }
  }
}

export type PostIdempotentStreamOptions = PostIdempotentOptions & {
  /** 코치가 쓰는 글이 한 조각 올 때마다. */
  onDelta?: (text: string) => void;
  /** 쓰던 조각을 버려야 할 때(오류·끊김·일반 호출로 전환). */
  onReset?: () => void;
};

/**
 * postIdempotent 의 스트리밍판. 스트림 경로(streamPath)로 시도하고, 서버가 모르거나(404·405) 스트림이
 * 아니거나 도중에 끊기면 같은 request_id·본문으로 일반 경로(path)를 부른다. 서버는 끊겨도 끝까지 만들어
 * 저장하므로 일반 호출이 저장된 결과를 돌려준다(처리 중 409 는 postIdempotent 가 기다렸다 재시도한다).
 * 전체 제한 시간(deadlineMs, 기본 120초)은 두 시도가 함께 쓴다. 동의 시트가 떠 있던 시간은 세지 않는다.
 */
export async function postIdempotentStream<T>(
  streamPath: string,
  path: string,
  body: unknown,
  options: PostIdempotentStreamOptions = {},
): Promise<ApiResponse<T>> {
  const requestId = options.requestId ?? newRequestId();
  const deadlineMs = options.deadlineMs ?? 120_000;
  const startedAt = Date.now();
  const sheetMsAtStart = consentPromptElapsedMs(startedAt);
  const remainingMs = () => {
    const now = Date.now();
    return deadlineMs - (now - startedAt - (consentPromptElapsedMs(now) - sheetMsAtStart));
  };
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const fallback = () => {
    const leftMs = remainingMs();
    if (leftMs <= 0) throw deadlineError();
    return postIdempotent<T>(path, body, {
      requestId,
      signal: options.signal,
      deadlineMs: leftMs,
    });
  };
  if (typeof ReadableStream === "undefined" || typeof TextDecoder === "undefined") return fallback();

  const attempt = signalUntilDeadline(options.signal, remainingMs);
  try {
    let response: ApiResponse<T>;
    try {
      response = await apiFetch<T>(streamPath, {
        method: "POST",
        body: serializedBody,
        headers: { "X-Request-Id": requestId, Accept: "text/event-stream" },
        signal: attempt.signal,
        stream: true,
      });
    } catch (error) {
      const info =
        error instanceof ApiError
          ? { status: error.status, code: error.code }
          : error instanceof NetworkError
            ? { status: 0, network: true }
            : null;
      if (!info || streamFailureAction(info) === "throw") throw error;
      attempt.cleanup();
      options.onReset?.();
      return await fallback();
    }

    // 스트림이 아닌 성공 응답(프록시·구버전)은 본문을 이미 읽은 일반 응답이다.
    if (!response.stream) return response;

    const outcome = await consumeCoachStream<T>(response.stream.getReader(), (text) => options.onDelta?.(text));
    if (attempt.signal.aborted && outcome.kind === "dropped") throw abortReason(attempt.signal);
    if (outcome.kind === "done") return { status: response.status, data: outcome.value };
    attempt.cleanup();
    options.onReset?.();
    if (outcome.kind === "dropped") return await fallback();
    const error = toApiError(
      outcome.status,
      outcome.detail === undefined ? undefined : { detail: outcome.detail },
    );
    if (streamFailureAction({ status: error.status, code: error.code }) === "fallback") {
      return await fallback();
    }
    throw error;
  } finally {
    attempt.cleanup();
  }
}
