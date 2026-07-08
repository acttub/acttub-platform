import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { jsonError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireTermsAccepted();
  const { sessionId } = await context.params;
  const result = coachSessionService.createSignedVideoUrl(sessionId, auth.userId);

    if (!result) {
      return jsonError(
        404,
        "video_not_found",
        "Session video was not found or is unavailable.",
      );
    }

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
