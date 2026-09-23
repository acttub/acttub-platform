import { apiFetch } from "./client";
import { ApiError, errorMessage } from "./errors";
import { postIdempotent } from "./idempotency";
import type {
  Conversation,
  ConversationReplyRequest,
  ConversationStartRequest,
  ConversationTurnResponse,
} from "../../practice/api-types";

/**
 * 코치 대화(practice.coach). 대화는 회차와 1:1이고 시작·답 모두 request_id 로 멱등하다.
 * 같은 id·같은 본문 재전송은 먼저 만든 답을 그대로 받고, 본문이 다르면 422 request_fingerprint_mismatch.
 * 저장 때 revision 이 다르면 409 conversation_conflict — 화면은 입력을 보존하고 대화를 다시 읽는다.
 *
 * 타입은 현재 OpenAPI 생성 계약을 따른다(src/lib/practice/api-types.ts).
 */

/** 배우 답의 길이 한도. 서버도 같은 값으로 막는다(422). */
export const ACTOR_REPLY_MAX = 300;

/**
 * 지문 불일치는 같은 코드를 리딩 대본 저장도 쓴다(그쪽 문구는 대본 이야기를 한다). 코드만 보는 공용
 * 문구로는 두 자리를 함께 맞출 수 없어 대화의 문구는 여기서 고른다.
 */
const FINGERPRINT_MISMATCH_MESSAGE = "먼저 보낸 답과 달라요. 화면을 새로 고친 뒤 다시 보내 주세요.";
const REPLY_FAILED_MESSAGE = "답을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";

/** 대화 화면이 쓰는 오류 문구. 대화만의 사정이 있는 것만 여기서 고르고 나머지는 공용 문구다. */
export function conversationErrorMessage(cause: unknown, fallback: string = REPLY_FAILED_MESSAGE): string {
  if (isFingerprintMismatch(cause)) return FINGERPRINT_MISMATCH_MESSAGE;
  return errorMessage(cause, fallback);
}

export function isConversationConflict(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409 && cause.code === "conversation_conflict";
}

export function isClosedConversation(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409 && cause.code === "conversation_closed";
}

export function isFingerprintMismatch(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 422 && cause.code === "request_fingerprint_mismatch";
}

/** 분석이 끝난 회차에서 대화를 연다. 열린 대화가 있으면 서버가 그것을 그대로 돌려준다. */
export async function startConversation(
  practiceId: string,
  options: { requestId: string; signal?: AbortSignal },
): Promise<ConversationTurnResponse> {
  const body: ConversationStartRequest = { practice_id: practiceId, request_id: options.requestId };
  const { data } = await postIdempotent<ConversationTurnResponse>("/v2/coach/start", body, {
    requestId: options.requestId,
    signal: options.signal,
  });
  return data;
}

/**
 * 답 하나를 보낸다. 앞뒤 공백을 떼고 보내므로 같은 답의 재전송은 지문도 같다.
 * 길이는 보내기 전에 막는다 — 300자가 넘은 답이 서버까지 갔다가 422 로 돌아오면 배우는 그 사이에
 * 쓴 것을 잃는다.
 */
export async function replyConversation(
  input: { conversationId: string; text: string; revision: number },
  options: { requestId: string; signal?: AbortSignal },
): Promise<ConversationTurnResponse> {
  const text = input.text.trim();
  if ([...text].length > ACTOR_REPLY_MAX) {
    throw new Error(`답은 ${ACTOR_REPLY_MAX}자까지 보낼 수 있어요.`);
  }
  const body: ConversationReplyRequest = {
    conversation_id: input.conversationId,
    request_id: options.requestId,
    text,
    revision: input.revision,
  };
  const { data } = await postIdempotent<ConversationTurnResponse>("/v2/coach/reply", body, {
    requestId: options.requestId,
    signal: options.signal,
  });
  return data;
}

/** 대화 하나를 통째로 읽는다. 충돌 뒤 최신 revision·상태·턴을 여기서 받는다. */
export async function getConversation(
  conversationId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Conversation> {
  const { data } = await apiFetch<Conversation>(
    `/v2/coach/conversations/${encodeURIComponent(conversationId)}`,
    { signal: options.signal },
  );
  return data;
}
