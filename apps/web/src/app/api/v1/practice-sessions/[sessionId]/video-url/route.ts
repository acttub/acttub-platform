import { coachSessionService } from "@/server/services/coach-session-service";
import { jsonError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const result = coachSessionService.createSignedVideoUrl(sessionId);

  if (!result) {
    return jsonError(404, "video_not_found", "Session video was not found or is unavailable.");
  }

  return jsonResponse(result);
}
