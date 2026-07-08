import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { jsonError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireTermsAccepted();
  const { sessionId } = await context.params;
  const result = coachSessionService.softHideSession(sessionId, auth.userId);

    if (!result) {
      return jsonError(404, "session_not_found", "Session was not found.");
    }

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
