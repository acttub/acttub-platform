import { getVideo } from "./videos";
import { ApiError } from "./errors";
import type { PracticeAnalysis, Video } from "../../practice/api-types";
import { apiFetch } from "./client";
import { postIdempotent } from "./idempotency";
import { newRequestId } from "../../reading/request-id";
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
// 트랜잭션으로 만들어진다. 타입은 현재 OpenAPI 생성 계약을 따른다(src/lib/practice/api-types.ts).

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

export type PracticeDetail = Practice & { video: Video | null; analysis: PracticeAnalysis | null };

export async function getPractice(practiceId: string, options: { signal?: AbortSignal } = {}): Promise<PracticeDetail> {
  const { data } = await apiFetch<Practice>(practicePath(practiceId), { signal: options.signal });
  let video: Video | null = null;
  if (data.video_id) {
    try {
      video = await getVideo(data.video_id, options);
    } catch (cause) {
      // 영상이 없어도 남아 있는 대화·노트는 읽을 수 있다.
      if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
    }
  }
  let analysis: PracticeAnalysis | null = null;
  if (data.analysis_status === "ready" || data.analysis_status === "partial") {
    try {
      const response = await apiFetch<PracticeAnalysis>(`${practicePath(practiceId)}/analysis`, { signal: options.signal });
      analysis = response.data;
    } catch (cause) {
      // 오래된 회차에 공개 요약이 없어도 대화·노트는 읽는다.
      if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
    }
  }
  return { ...data, video, analysis };
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
 * 409 practice_in_progress). 요청 id 로 멱등하다: 두 번 눌러도 작업은 하나다.
 * 이름은 옛 화면의 부름 자리와 같다(회귀 테스트가 그 이름을 지킨다).
 */
export async function reanalyzeSession(
  practiceId: string,
  options: { requestId?: string } = {},
): Promise<Practice> {
  const requestId = options.requestId ?? newRequestId();
  const { data } = await postIdempotent<Practice>(
    `${practicePath(practiceId)}/analyze`,
    { request_id: requestId },
    { requestId },
  );
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
export async function pollPracticeUntilSettled(practiceId: string, options: PollPracticeOptions = {}): Promise<PracticeDetail> {
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
