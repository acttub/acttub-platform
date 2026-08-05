import type { ApiResponse } from "./client";
import {
  postIdempotent,
  type PostIdempotentOptions,
} from "./idempotency";
import type {
  CoachConfirmReq,
  CoachConfirmResponse,
  CoachReplyReq,
  CoachStartReq,
  CoachTurnResponse,
} from "./types";

export function startCoach(
  body: CoachStartReq,
  options?: PostIdempotentOptions,
): Promise<ApiResponse<CoachTurnResponse>> {
  return postIdempotent<CoachTurnResponse>("/v2/coach/start", body, options);
}

export function replyCoach(
  body: CoachReplyReq,
  options?: PostIdempotentOptions,
): Promise<ApiResponse<CoachTurnResponse>> {
  return postIdempotent<CoachTurnResponse>("/v2/coach/reply", body, options);
}

export function confirmCoach(
  body: CoachConfirmReq,
  options?: PostIdempotentOptions,
): Promise<ApiResponse<CoachConfirmResponse>> {
  return postIdempotent<CoachConfirmResponse>("/v2/coach/confirm", body, options);
}
