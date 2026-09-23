import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type MemoryItem = components["schemas"]["ActorMemoryItem"];
export type MemoryResponse = components["schemas"]["ActorMemoryResponse"];

/**
 * 배우가 화면에서 다루는 칸(practice.memory). 1.0.0 부터 넷이다.
 *
 * 성별·나이는 기억이 아니라 **프로필**이다(account.profile). 코치가 영상이나 말투에서 짐작하지
 * 않는다는 규칙은 그대로이고, 적는 자리만 옮겼다 — 연습을 가로질러 남는 값(목표·막히는 지점·화법)과
 * 사람의 기본 정보는 사는 곳이 다르다. 웹에는 프로필이 없어(게스트뿐) 그 자리에 앱 이관 안내를 둔다.
 */
export const MEMORY_FIELDS = [
  "goal",
  "blockage",
  "speech_self",
  "speech_actual",
] as const;

export type MemoryField = (typeof MEMORY_FIELDS)[number];

/** 기억 화면에서 뺀 칸. 프로필로 안내한다. */
export const PROFILE_FIELDS = ["gender", "age"] as const;

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
