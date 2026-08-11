import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type MemoryItem = components["schemas"]["MemoryItem"];
export type MemoryResponse = components["schemas"]["MemoryResponse"];

/**
 * 배우가 화면에서 다루는 칸.
 *
 * 성별·나이는 아직 열지 않는다 — 배우에게 열어 주는 순간 개인정보 수집 항목이
 * 느는 것이라 동의 문서 확인이 먼저다. 지금은 코치도 이 넷만 쓴다.
 */
export const MEMORY_FIELDS = [
  "goal",
  "blockage",
  "speech_self",
  "speech_actual",
] as const;

export type MemoryField = (typeof MEMORY_FIELDS)[number];

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
