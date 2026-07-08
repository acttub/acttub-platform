import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireTermsAccepted();
    const { sessionId } = await context.params;
    const body = (await request.json().catch(() => ({ hidden: true }))) as {
      hidden?: unknown;
    };

    if (body.hidden !== true) {
      return jsonError(
        400,
        "validation_error",
        "Only hidden=true is supported for Slice 1 soft-hide.",
      );
    }

    const result = coachSessionService.softHideSession(sessionId, auth.userId);

    if (!result) {
      return jsonError(404, "session_not_found", "Session was not found.");
    }

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
