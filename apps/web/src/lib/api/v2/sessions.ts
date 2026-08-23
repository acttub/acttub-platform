import { apiFetch, type ApiResponse } from "./client";
import {
  postIdempotent,
  type PostIdempotentOptions,
} from "./idempotency";
import type {
  PracticeSessionCreateResponse,
  PracticeSessionDetail,
  PracticeSessionListResponse,
  PracticeSessionRequest,
} from "./types";
import type { components } from "../v2-schema";

const DEFAULT_POLL_INTERVAL_MS = 10_000;

export type CreatePracticeSessionResult = {
  accepted: boolean;
  session: PracticeSessionCreateResponse;
};

export type GetPracticeSessionOptions = {
  signal?: AbortSignal;
};

export type PracticeSessionStatusResponse =
  components["schemas"]["PracticeSessionStatusResponse"];

export type PollSessionOptions = GetPracticeSessionOptions & {
  intervalMs?: number;
  onStatus?: (status: PracticeSessionStatusResponse["status"]) => void;
};

function sessionPath(sessionId: string): string {
  return `/v2/practice-sessions/${encodeURIComponent(sessionId)}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function createPracticeSession(
  body: PracticeSessionRequest,
  options?: PostIdempotentOptions,
): Promise<CreatePracticeSessionResult> {
  const { status, data } = await postIdempotent<PracticeSessionCreateResponse>(
    "/v2/practice-sessions",
    body,
    options,
  );

  return { accepted: status === 202, session: data };
}

export async function listPracticeSessions(): Promise<PracticeSessionListResponse> {
  const { data } = await apiFetch<PracticeSessionListResponse>(
    "/v2/practice-sessions",
  );
  return data;
}

export async function getPracticeSession(
  sessionId: string,
  options: GetPracticeSessionOptions = {},
): Promise<PracticeSessionDetail> {
  const { data } = await apiFetch<PracticeSessionDetail>(sessionPath(sessionId), {
    signal: options.signal,
  });
  return data;
}

export async function getPracticeSessionStatus(
  sessionId: string,
  options: GetPracticeSessionOptions = {},
): Promise<PracticeSessionStatusResponse> {
  const { data } = await apiFetch<PracticeSessionStatusResponse>(
    `${sessionPath(sessionId)}/status`,
    { signal: options.signal },
  );
  return data;
}

export async function deletePracticeSession(sessionId: string): Promise<void> {
  await apiFetch<void>(sessionPath(sessionId), { method: "DELETE" });
}

export function reanalyzeSession(
  sessionId: string,
  options?: PostIdempotentOptions,
): Promise<ApiResponse<PracticeSessionCreateResponse>> {
  return postIdempotent<PracticeSessionCreateResponse>(
    `${sessionPath(sessionId)}/analyze`,
    undefined,
    options,
  );
}

export async function pollSessionUntilSettled(
  sessionId: string,
  options: PollSessionOptions = {},
): Promise<PracticeSessionDetail> {
  const { intervalMs = DEFAULT_POLL_INTERVAL_MS, onStatus, signal } = options;

  while (true) {
    if (signal?.aborted) throw abortReason(signal);

    const sessionStatus = await getPracticeSessionStatus(sessionId, { signal });
    onStatus?.(sessionStatus.status);

    if (sessionStatus.status === "analyzed" || sessionStatus.status === "failed") {
      return getPracticeSession(sessionId, { signal });
    }

    await wait(intervalMs, signal);
  }
}
