import { requireApiTermsAccepted } from "@/server/services/api-auth";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError, jsonError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId } = await context.params;
    const result = coachSessionService.getSignedVideoUrl(sessionId, auth.userId);

    if (!result) {
      return jsonError(404, "session_not_found", "Session was not found.");
    }

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
