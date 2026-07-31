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

// 장면 세 칸은 화면에서 "비워 두셔도 돼요. 빈 칸은 대화에서 물어봐요"로 안내하지만,
// 서버는 세 칸 모두 min_length=1을 요구한다. 빈 칸으로 제출하면 업로드를 끝낸 뒤
// createPracticeSession에서만 422가 나고 화면은 아무 말 없이 멈춘다(실사용자 4명이 여기서
// 이탈했다). 자리표시자를 채워 넣어 그 구간을 넘긴다 — 코치는 두 글자 미만을 모호값으로
// 걸러내므로(acting_agent.targeting.is_vague) 빈 칸과 똑같이 되묻는다.
const BLANK_PLACEHOLDER = ".";

export function fillBlankScene(
  body: PracticeSessionRequest,
): PracticeSessionRequest {
  const filled = (value: string | undefined) =>
    value && value.trim() ? value : BLANK_PLACEHOLDER;

  return {
    ...body,
    situation: filled(body.situation),
    character_context: filled(body.character_context),
    subtext: filled(body.subtext),
  };
}

export async function createPracticeSession(
  body: PracticeSessionRequest,
  options?: PostIdempotentOptions,
): Promise<CreatePracticeSessionResult> {
  const { status, data } = await postIdempotent<PracticeSessionCreateResponse>(
    "/v2/practice-sessions",
    fillBlankScene(body),
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
