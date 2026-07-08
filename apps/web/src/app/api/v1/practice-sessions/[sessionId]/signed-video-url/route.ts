import { NextResponse } from "next/server";
import { coachSessionService } from "@/server/services/coach-session-service";
import { jsonError } from "../../../sessions/http";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const result = coachSessionService.getSignedVideoUrl(sessionId);

  if (!result) {
    return jsonError(404, "session_not_found", "Session was not found.");
  }

  return NextResponse.json(result);
}
