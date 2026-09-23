import { apiFetch } from "./client";
import type { MemorizationEntry, MemorizationStatus } from "../../reading/api-types";

// 암기 상태(reading.memorization). 조회는 대본 단위로 한 번에, 갱신은 줄마다 즉시.

export async function listMemorization(
  scriptId: string,
  options: { signal?: AbortSignal } = {},
): Promise<MemorizationEntry[]> {
  const { data } = await apiFetch<MemorizationEntry[]>(
    `/v2/reading/scripts/${encodeURIComponent(scriptId)}/memorization`,
    { signal: options.signal },
  );
  return data;
}

/** 그 대본의 대사 줄이면 배역과 무관하게 받는다. 지문·장면 줄은 422 invalid_line. */
export async function setMemorization(lineId: string, status: MemorizationStatus): Promise<MemorizationEntry> {
  const { data } = await apiFetch<MemorizationEntry>(`/v2/reading/lines/${encodeURIComponent(lineId)}/memorization`, {
    method: "PUT",
    body: { status },
  });
  return data;
}
