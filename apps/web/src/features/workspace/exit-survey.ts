/**
 * 이탈 설문(practice.feedback)의 규칙. 브라우저 API를 쓰지 않아 그대로 테스트한다.
 *
 * 대상은 코치 대화(coach)와 노트(report) 화면에서의 이탈이고 계기는 x·leave·back 셋이다.
 * 본문은 공백을 정리한 뒤 1~100자, 연락처는 각각 80자이고 없어도 보낼 수 있다.
 * 건너뛰기는 본문 없는 행(dismissed)으로 남기므로 여기서 걸러 내지 않는다.
 */
import type { FeedbackScreen } from "@/lib/practice/api-types";

export const FEEDBACK_BODY_MAX = 100;
export const FEEDBACK_CONTACT_MAX = 80;

/**
 * 수집 범위를 사실대로 말한다. 이름 칸은 없지만 연락처를 적으면 사람과 이어지므로
 * "이름은 남지 않아요"가 아니라 "보이지 않아요"다.
 */
export const PRIVACY_NOTICE = "답변은 서비스 개선에만 써요 · 이름은 보이지 않아요";

/** 화면 이름은 서버의 값(coach·report)으로 보낸다. 화면 안의 이름(chat·note)과 다르다. */
export function feedbackScreen(kind: "chat" | "note"): FeedbackScreen {
  return kind === "chat" ? "coach" : "report";
}

/** 줄바꿈과 연속 공백을 한 칸으로 줄인다. 서버도 같은 값을 세어 100자를 잰다. */
export function normalizeBody(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type FeedbackDraft = {
  body: string;
  email: string;
  phone: string;
};

export type FeedbackPayload = {
  body: string;
  contact_email?: string;
  contact_phone?: string;
};

export type FeedbackValidation =
  | { ok: true; payload: FeedbackPayload }
  | { ok: false; message: string };

function tooLong(value: string, max: number): boolean {
  return [...value].length > max;
}

/** 보내기를 누른 순간의 검사. 서버가 거부할 것을 화면에서 먼저 말해 준다. */
export function validateFeedback(draft: FeedbackDraft): FeedbackValidation {
  const body = normalizeBody(draft.body);
  if (!body) return { ok: false, message: "한 줄만 적어 주세요." };
  if (tooLong(body, FEEDBACK_BODY_MAX)) {
    return { ok: false, message: `소감은 ${FEEDBACK_BODY_MAX}자까지 적을 수 있어요.` };
  }
  const email = draft.email.trim();
  const phone = draft.phone.trim();
  if (tooLong(email, FEEDBACK_CONTACT_MAX) || tooLong(phone, FEEDBACK_CONTACT_MAX)) {
    return { ok: false, message: `연락처는 ${FEEDBACK_CONTACT_MAX}자까지 적을 수 있어요.` };
  }
  return {
    ok: true,
    payload: {
      body,
      ...(email ? { contact_email: email } : {}),
      ...(phone ? { contact_phone: phone } : {}),
    },
  };
}
