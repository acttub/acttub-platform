import { coachSessionService } from "@/server/services/coach-session-service";
import { jsonError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const result = coachSessionService.softHideSession(sessionId);

  if (!result) {
    return jsonError(404, "session_not_found", "Session was not found.");
  }

  return jsonResponse(result);
}
