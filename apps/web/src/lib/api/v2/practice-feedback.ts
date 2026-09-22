import type { components } from "../v2-schema";
import { apiFetch } from "./client";
import { postIdempotent } from "./idempotency";
import type { FeedbackRequest, FeedbackScreen, FeedbackTrigger } from "../../practice/api-types";

/**
 * 이탈 설문 접수(practice.feedback). 저장은 DB 커밋으로 끝나고 시트 복제는 서버가 맡는다 —
 * 화면은 외부 폼을 띄우지 않는다.
 *
 * 타입은 현재 OpenAPI 생성 계약을 따른다(src/lib/practice/api-types.ts).
 */

/**
 * 자동 노출 직전에 계정의 노출 표식을 선점한다. 선점한 기기만 시트를 띄운다 — 두 기기가
 * 동시에 물어도 하나만 뜬다. 물어볼 수 없으면(오류·오프라인) 띄우지 않는다: 묻지 못한 것이
 * 두 번 묻는 것보다 낫다.
 */
export async function claimExitSurvey(options: { signal?: AbortSignal } = {}): Promise<boolean> {
  try {
    const { data } = await apiFetch<components["schemas"]["PracticeFeedbackStatus"]>("/v2/me/practice-feedback/claim", {
      method: "POST",
      signal: options.signal,
    });
    return data.asked_now === true;
  } catch {
    return false;
  }
}

export type FeedbackInput = {
  practiceId: string | null;
  screen: FeedbackScreen;
  trigger: FeedbackTrigger;
  /** 건너뛰기(dismissed)면 없다. */
  body?: string;
  contact_email?: string;
  contact_phone?: string;
};

/** 소감 하나를 접수한다. 같은 요청 id 재전송은 같은 행이다(오프라인 뒤 재시도). */
export async function submitPracticeFeedback(
  input: FeedbackInput,
  options: { requestId: string; signal?: AbortSignal },
): Promise<components["schemas"]["PracticeFeedbackResponse"]> {
  const { practiceId, screen, trigger, ...rest } = input;
  const body: FeedbackRequest = {
    request_id: options.requestId,
    practice_id: practiceId,
    screen,
    trigger,
    ...rest,
  };
  const { data } = await postIdempotent<components["schemas"]["PracticeFeedbackResponse"]>("/v2/practice-feedback", body, {
    requestId: options.requestId,
    signal: options.signal,
  });
  return data;
}
