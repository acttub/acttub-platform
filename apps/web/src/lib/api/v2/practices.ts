import { apiFetch } from "./client";
import { postIdempotent } from "./idempotency";
import type {
  Practice,
  PracticeCancelResponse,
  PracticeContinueRequest,
  PracticeCreateRequest,
  PracticeGroup,
  PracticeGroupFilter,
  PracticeGroupListResponse,
  PracticeGroupPatch,
  PracticeStatusResponse,
} from "../../practice/api-types";

// 연습 회차·묶음(practice.start·resume·analyze·library). 시작·이어하기는 request_id 멱등이고 회차와 분석 작업이 한
// 트랜잭션으로 만들어진다. 타입은 임시이며 통합 작업이 생성 타입으로 바꾼다(src/lib/practice/api-types.ts).

/** 웹은 10초 간격으로 상태를 읽는다(앱은 4초). 화면을 떠나면 조회만 멈춘다. */
export const PRACTICE_POLL_INTERVAL_MS = 10_000;

export type PracticeStartResult = {
  /** 201 이면 새 회차, 200 이면 같은 요청 id 의 재전송에 먼저 만든 회차가 온 것 */
  created: boolean;
  practice: Practice;
};

function practicePath(practiceId: string): string {
  return `/v2/practices/${encodeURIComponent(practiceId)}`;
}

/** 첫 회차(새 묶음). 영상은 이미 보관함에 확정돼 있어야 한다(422 video_not_ready). */
export async function createPractice(
  body: Omit<PracticeCreateRequest, "request_id">,
  options: { requestId: string; signal?: AbortSignal },
): Promise<PracticeStartResult> {
  const { status, data } = await postIdempotent<Practice>("/v2/practices", { request_id: options.requestId, ...body } satisfies PracticeCreateRequest, {
    requestId: options.requestId,
    signal: options.signal,
  });
  return { created: status === 201, practice: data };
}

/** 같은 묶음의 다음 회차. video_id 가 없으면 같은 영상이다. 진행 중 회차가 있으면 409 practice_in_progress. */
export async function continuePractice(
  practiceId: string,
  body: Omit<PracticeContinueRequest, "request_id">,
  options: { requestId: string; signal?: AbortSignal },
): Promise<PracticeStartResult> {
  const { status, data } = await postIdempotent<Practice>(
    `${practicePath(practiceId)}/continue`,
    { request_id: options.requestId, ...body } satisfies PracticeContinueRequest,
    { requestId: options.requestId, signal: options.signal },
  );
  return { created: status === 201, practice: data };
}

export async function listPracticeGroups(
  filter: PracticeGroupFilter = "all",
  options: { signal?: AbortSignal } = {},
): Promise<PracticeGroupListResponse> {
  const { data } = await apiFetch<PracticeGroupListResponse>(`/v2/practices?filter=${filter}`, { signal: options.signal });
  return data;
}

export async function getPractice(practiceId: string, options: { signal?: AbortSignal } = {}): Promise<Practice> {
  const { data } = await apiFetch<Practice>(practicePath(practiceId), { signal: options.signal });
  return data;
}

export async function getPracticeStatus(practiceId: string, options: { signal?: AbortSignal } = {}): Promise<PracticeStatusResponse> {
  const { data } = await apiFetch<PracticeStatusResponse>(`${practicePath(practiceId)}/status`, { signal: options.signal });
  return data;
}

/** "그만두기" — failed/cancelled 로 종결하고 lease 를 지운다. 화면 이탈은 취소가 아니다. */
export async function cancelPractice(practiceId: string): Promise<PracticeCancelResponse> {
  const { data } = await apiFetch<PracticeCancelResponse>(`${practicePath(practiceId)}/cancel`, { method: "POST", body: {} });
  return data;
}

/**
 * 실패한 회차의 명시적 재시도 — 새 작업과 함께 analyzing 으로 돌아간다(다른 진행 중 회차가 없을 때만, 아니면
 * 409 practice_in_progress). 스펙 표에 경로가 없어 계획안으로 둔다. 이름은 옛 화면의 부름 자리와 같다.
 */
export async function reanalyzeSession(practiceId: string): Promise<Practice> {
  const { data } = await apiFetch<Practice>(`${practicePath(practiceId)}/retry`, { method: "POST", body: {} });
  return data;
}

/** 묶음 즐겨찾기·숨김·제목. 첫 회차(root) 의 속성이다. */
export async function updatePracticeGroup(rootId: string, patch: PracticeGroupPatch): Promise<PracticeGroup> {
  const { data } = await apiFetch<PracticeGroup>(`${practicePath(rootId)}/group`, { method: "PATCH", body: patch });
  return data;
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

export type PollPracticeOptions = {
  intervalMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: PracticeStatusResponse) => void;
};

/** 작업이 succeeded·failed 로 끝날 때까지 상태를 읽고, 끝나면 상세를 받는다. */
export async function pollPracticeUntilSettled(practiceId: string, options: PollPracticeOptions = {}): Promise<Practice> {
  const { intervalMs = PRACTICE_POLL_INTERVAL_MS, onStatus, signal } = options;
  while (true) {
    if (signal?.aborted) throw abortReason(signal);
    const status = await getPracticeStatus(practiceId, { signal });
    onStatus?.(status);
    const job = status.job?.status;
    if (job === "succeeded" || job === "failed" || (job === undefined && status.stage !== "analyzing")) {
      return getPractice(practiceId, { signal });
    }
    await wait(intervalMs, signal);
  }
}
