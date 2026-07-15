import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError, jsonError, jsonResponse } from "../../../../http";
import { readBoundedJson } from "@/server/http/bounded-json";

type RouteContext = { params: Promise<{ sessionId: string; observationId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId, observationId } = await context.params;
    const payload = await readBoundedJson(request);
    const result = await coachSessionService.updateObservation(
      sessionId,
      auth.userId,
      observationId,
      payload,
    );

    if (!result) {
      return jsonError(
        404,
        "observation_not_found",
        "Session or observation was not found.",
      );
    }
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
