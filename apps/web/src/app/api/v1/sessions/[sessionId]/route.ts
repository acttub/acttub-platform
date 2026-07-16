import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError, jsonError, jsonResponse } from "../../http";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId } = await context.params;
    const session = await coachSessionService.getSession(sessionId, auth.userId);

    if (!session) return jsonError(404, "session_not_found", "Session was not found.");
    return jsonResponse({ session });
  } catch (error) {
    return handleApiError(error);
  }
}
