import { apiFetch } from "./client";
import { postIdempotent } from "./idempotency";
import type {
  ScriptCreateRequest,
  ScriptDetail,
  ScriptListResponse,
  ScriptUpdateRequest,
} from "../../reading/api-types";

// 대본 등록·목록·상세·수정·삭제(reading.script). 타입은 생성 타입이다(src/lib/reading/api-types.ts).

export type CreateScriptOptions = {
  /**
   * 기기가 만든 요청 id(UUID). 확인 화면이 같은 본문에는 같은 id 를 다시 쓰므로, 저장 버튼을
   * 두 번 눌러도 서버에는 대본이 하나다. 본문의 request_id 와 X-Request-Id 헤더에 같이 싣는다 —
   * 서버가 어느 쪽을 읽든 같은 값이다.
   */
  requestId: string;
  signal?: AbortSignal;
};

export type CreateScriptResult = {
  /** 201 이면 새로 만든 것, 200 이면 같은 요청의 재전송에 먼저 만든 대본이 온 것 */
  created: boolean;
  script: ScriptDetail;
};

function scriptPath(scriptId: string): string {
  return `/v2/reading/scripts/${encodeURIComponent(scriptId)}`;
}

/**
 * 대본 저장. 연결이 끊기면 멱등 계층이 같은 요청 id·같은 본문으로 다시 보내고, 게스트의 첫
 * 등록에 403 consent_required 가 오면 공용 클라이언트가 시트를 띄운 뒤 같은 요청을 다시 보낸다.
 */
export async function createScript(
  body: Omit<ScriptCreateRequest, "request_id">,
  options: CreateScriptOptions,
): Promise<CreateScriptResult> {
  const request: ScriptCreateRequest = { request_id: options.requestId, ...body };
  const { status, data } = await postIdempotent<ScriptDetail>("/v2/reading/scripts", request, {
    requestId: options.requestId,
    signal: options.signal,
  });
  return { created: status === 201, script: data };
}

/** 최근 고친 순 목록. 검색어는 제목과 배역 이름만 찾는다(대사 본문은 찾지 않는다). */
export async function listScripts(
  query?: string,
  options: { signal?: AbortSignal } = {},
): Promise<ScriptListResponse> {
  const q = query?.trim();
  const path = q ? `/v2/reading/scripts?q=${encodeURIComponent(q)}` : "/v2/reading/scripts";
  const { data } = await apiFetch<ScriptListResponse>(path, { signal: options.signal });
  return data;
}

export async function getScript(
  scriptId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ScriptDetail> {
  const { data } = await apiFetch<ScriptDetail>(scriptPath(scriptId), { signal: options.signal });
  return data;
}

/** 제목·배역 이름·목소리만 고친다. 줄 구조는 저장 뒤 고정이다. */
export async function updateScript(
  scriptId: string,
  body: ScriptUpdateRequest,
): Promise<ScriptDetail> {
  const { data } = await apiFetch<ScriptDetail>(scriptPath(scriptId), { method: "PATCH", body });
  return data;
}

/** 배역·줄·회차·녹음·암기 상태가 함께 지워지고 되돌릴 수 없다. */
export async function deleteScript(scriptId: string): Promise<void> {
  await apiFetch<void>(scriptPath(scriptId), { method: "DELETE" });
}
