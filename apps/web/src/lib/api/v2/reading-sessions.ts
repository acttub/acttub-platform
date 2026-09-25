import { apiFetch } from "./client";
import { postIdempotent } from "./idempotency";
import type {
  ProgressRequest,
  ProgressResponse,
  SessionCreateRequest,
  SessionDetail,
  SessionListResponse,
} from "../../reading/api-types";

// 리딩 회차 시작·목록·상세·진행 저장·삭제(reading.session). 타입은 생성 타입이다(src/lib/reading/api-types.ts).

export type CreateSessionResult = {
  /** 201 이면 새 회차, 200 이면 같은 요청 id 의 재전송에 먼저 만든 회차가 온 것 */
  created: boolean;
  session: SessionDetail;
};

function sessionPath(sessionId: string): string {
  return `/v2/reading/sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * 회차 시작. 열린 회차가 있으면 서버가 같은 트랜잭션에서 stopped 로 바꾸고 새 회차를 만든다.
 * 연결이 끊기면 멱등 계층이 같은 요청 id 로 다시 보내 회차가 둘이 되지 않는다.
 */
export async function createSession(
  scriptId: string,
  body: Omit<SessionCreateRequest, "request_id">,
  options: { requestId: string; signal?: AbortSignal },
): Promise<CreateSessionResult> {
  const request: SessionCreateRequest = { request_id: options.requestId, ...body };
  const { status, data } = await postIdempotent<SessionDetail>(
    `/v2/reading/scripts/${encodeURIComponent(scriptId)}/sessions`,
    request,
    { requestId: options.requestId, signal: options.signal },
  );
  return { created: status === 201, session: data };
}

/** 그 대본의 회차, 최근순 */
export async function listSessions(
  scriptId: string,
  options: { signal?: AbortSignal } = {},
): Promise<SessionListResponse> {
  const { data } = await apiFetch<SessionListResponse>(
    `/v2/reading/scripts/${encodeURIComponent(scriptId)}/sessions`,
    { signal: options.signal },
  );
  return data;
}

export async function getSession(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<SessionDetail> {
  const { data } = await apiFetch<SessionDetail>(sessionPath(sessionId), { signal: options.signal });
  return data;
}

/**
 * 진행 저장. 서버는 progress_seq 가 저장값보다 클 때만 반영하고 아니면 현재 값을 돌려준다.
 * 재시도는 부르는 쪽(src/lib/reading/session/progress.ts)이 최신 값으로 한다.
 */
export async function saveProgress(
  sessionId: string,
  body: ProgressRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ProgressResponse> {
  const { data } = await apiFetch<ProgressResponse>(`${sessionPath(sessionId)}/progress`, {
    method: "PATCH",
    body,
    signal: options.signal,
  });
  return data;
}

/** 회차와 그 녹음이 지워진다. 암기 상태는 남는다. */
export async function deleteSession(sessionId: string): Promise<void> {
  await apiFetch<void>(sessionPath(sessionId), { method: "DELETE" });
}
