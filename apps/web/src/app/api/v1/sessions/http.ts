import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "@/lib/api/types";
import { ApiValidationError } from "@/server/services/coach-session-service";

export const jsonError = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiErrorResponse> =>
  NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );

export const handleApiError = (error: unknown): NextResponse<ApiErrorResponse> => {
  if (error instanceof SyntaxError) {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (error instanceof ApiValidationError) {
    return jsonError(400, "validation_error", error.message, error.details);
  }

  console.error(error);
  return jsonError(500, "internal_error", "Unexpected server error.");
};
