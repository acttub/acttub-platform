import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "@/lib/api/types";
import { privateNoStoreHeaders } from "@/server/http/cache";
import {
  ApiConfigurationError,
  ApiUpstreamError,
  ApiValidationError,
} from "@/server/services/coach-session-service";
import { ApiAuthError } from "@/server/services/auth-context";
import { ActingServiceError } from "@/server/services/acting-coach-service";

export const jsonResponse = <T>(
  body: T,
  init: ResponseInit = {},
): NextResponse<T> =>
  NextResponse.json(body, {
    ...init,
    headers: {
      ...privateNoStoreHeaders,
      ...init.headers,
    },
  });

export const jsonError = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiErrorResponse> =>
  jsonResponse(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );

export const handleApiError = (
  error: unknown,
): NextResponse<ApiErrorResponse> => {
  if (error instanceof SyntaxError) {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (error instanceof ApiAuthError) {
    return jsonError(error.status, error.code, error.message);
  }

  if (error instanceof ActingServiceError) {
    return jsonError(error.status, error.code, error.message, error.details as Record<string, string> | undefined);
  }

  if (error instanceof ApiValidationError) {
    return jsonError(400, "validation_error", error.message, error.details);
  }

  if (error instanceof ApiConfigurationError) {
    return jsonError(503, "configuration_error", error.message, error.details);
  }

  if (error instanceof ApiUpstreamError) {
    return jsonError(502, "upstream_error", error.message, error.details);
  }

  console.error(error);
  return jsonError(500, "internal_error", "Unexpected server error.");
};
