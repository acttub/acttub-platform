import { apiFetch } from "./client";
import type {
  ScriptDetail,
  ScriptListResponse,
  ScriptUpdateRequest,
} from "../../reading/api-types";

// 대본 목록·상세·수정·삭제(reading.script). 넣기는 reading-imports.ts 다. 타입은 생성 타입이다(src/lib/reading/api-types.ts).

function scriptPath(scriptId: string): string {
  return `/v2/reading/scripts/${encodeURIComponent(scriptId)}`;
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
