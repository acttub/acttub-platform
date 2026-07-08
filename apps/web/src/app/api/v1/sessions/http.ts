import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "@/lib/api/types";
import { ApiValidationError } from "@/server/services/coach-session-service";
import { ApiAuthError } from "@/server/services/auth-context";
import { privateNoStoreHeaders } from "@/server/http/cache";

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
    { status, headers: privateNoStoreHeaders },
  );

export const handleApiError = (error: unknown): NextResponse<ApiErrorResponse> => {
  if (error instanceof SyntaxError) {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (error instanceof ApiAuthError) {
    return jsonError(error.status, error.code, error.message);
  }

  if (error instanceof ApiValidationError) {
    return jsonError(400, "validation_error", error.message, error.details);
  }

  if (error instanceof ApiAuthError) {
    return jsonError(error.status, error.code, error.message);
  }

  console.error(error);
  return jsonError(500, "internal_error", "Unexpected server error.");
};
