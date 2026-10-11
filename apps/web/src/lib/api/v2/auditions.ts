import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type AuditionPostingList = components["schemas"]["AuditionPostingList"];
export type AuditionPosting = components["schemas"]["AuditionPosting"];

/** 기능이 꺼진 서버·빠진 키도 빈 목록으로 받는다 — 화면이 `items.length`를 바로 읽는다. */
export function normalizeAuditions(
  payload: Partial<AuditionPostingList> | null | undefined,
): AuditionPostingList {
  return {
    items: payload?.items ?? [],
    collected_at: payload?.collected_at ?? null,
  };
}

// 공개 정보다(app.audition: 로그인 무관). 보기만 하는 방문자에게 게스트 계정을 만들지 않게 토큰을 붙이지 않는다.
export async function getAuditions(options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<AuditionPostingList>("/v2/auditions", {
    auth: false,
    signal: options.signal,
  });
  return normalizeAuditions(data);
}
