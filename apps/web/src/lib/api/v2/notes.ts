import { apiFetch } from "./client";
import { ApiError } from "./errors";
import type { PracticeNote } from "../../practice/api-types";

/**
 * 연습 노트 조회(practice.note). 노트는 대화가 닫힌 뒤 한 번 만들어지고, 없는 회차도 흔하다
 * (짧게 끝난 기존 갈래 대화). 없는 것은 오류가 아니라 빈 자리라 null 로 돌려준다.
 *
 * 영상을 파기해도 노트는 열린다 — 재생만 못 한다.
 */
export async function getPracticeNote(
  practiceId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PracticeNote | null> {
  try {
    const { data } = await apiFetch<PracticeNote>(
      `/v2/practices/${encodeURIComponent(practiceId)}/note`,
      { signal: options.signal },
    );
    return data;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }
}
