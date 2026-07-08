import { NextResponse } from "next/server";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError, jsonError } from "../../../sessions/http";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const payload = await request.json();
    const result = coachSessionService.updateVisibility(sessionId, payload);

    if (!result) {
      return jsonError(404, "session_not_found", "Session was not found.");
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
