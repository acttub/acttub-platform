import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type MemoryItem = components["schemas"]["MemoryItem"];
export type MemoryResponse = components["schemas"]["MemoryResponse"];

/**
 * 배우가 화면에서 다루는 칸.
 *
 * 성별·나이는 **배우만 쓴다.** 코치는 영상이나 말투에서 추론하지 않는다 — 틀리면
 * 그 상태로 이후 모든 연습의 전제가 되고, 민감정보 추론이기도 하다. 데이터베이스
 * 제약(ck_actor_memory_demographics_actor_only)이 이걸 실제로 막고 있어서,
 * 여기 화면이 그 칸을 채울 수 있는 유일한 통로다.
 */
export const ACTOR_ONLY_FIELDS = ["gender", "age"] as const;

export const MEMORY_FIELDS = [
  ...ACTOR_ONLY_FIELDS,
  "goal",
  "blockage",
  "speech_self",
  "speech_actual",
] as const;

export type MemoryField = (typeof MEMORY_FIELDS)[number];

/** 코치가 절대 쓰지 않는 칸인지. 화면에서 다르게 안내한다. */
export function isActorOnlyField(field: MemoryField): boolean {
  return (ACTOR_ONLY_FIELDS as readonly string[]).includes(field);
}

/** 서버가 거부하는 길이. 화면에서 미리 막지 않으면 저장 순간에야 실패한다. */
export const MEMORY_VALUE_MAX_LENGTH = 1000;

export async function getMemory(
  options: { signal?: AbortSignal } = {},
): Promise<MemoryResponse> {
  const { data } = await apiFetch<MemoryResponse>("/v2/me/memory", {
    signal: options.signal,
  });
  return data;
}

/** 한 칸을 고친다. 배우가 고친 칸은 이후 코치가 덮어쓰지 않는다. */
export async function saveMemoryField(
  field: MemoryField,
  value: string,
): Promise<MemoryItem> {
  const { data } = await apiFetch<MemoryItem>(
    `/v2/me/memory/${encodeURIComponent(field)}`,
    { method: "PUT", body: { value } },
  );
  return data;
}

/** 한 칸을 지운다. 없는 칸을 지워도 성공이다. */
export async function deleteMemoryField(field: MemoryField): Promise<void> {
  await apiFetch<void>(`/v2/me/memory/${encodeURIComponent(field)}`, {
    method: "DELETE",
  });
}

/** 기억을 통째로 지운다. */
export async function deleteAllMemory(): Promise<void> {
  await apiFetch<void>("/v2/me/memory", { method: "DELETE" });
}
