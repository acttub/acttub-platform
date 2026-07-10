import { coachSessionService } from "@/server/services/coach-session-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonError, jsonResponse } from "../../../http";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId } = await context.params;
    const body = (await request.json()) as {
      hidden?: unknown;
    };

    const result = await coachSessionService.updateVisibility(
      sessionId,
      auth.userId,
      body,
    );

    if (!result) return jsonError(404, "session_not_found", "Session was not found.");
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
