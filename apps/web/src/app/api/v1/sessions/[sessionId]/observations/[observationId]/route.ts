import { NextResponse } from "next/server";
import type { UpdateObservationResponse } from "@/lib/api/types";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError, jsonError } from "../../../http";

type RouteContext = {
  params: Promise<{
    sessionId: string;
    observationId: string;
  }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse<UpdateObservationResponse>> {
  try {
    const { sessionId, observationId } = await context.params;
    const payload = await request.json();
    const result = coachSessionService.updateObservation(sessionId, observationId, payload);

    if (!result) {
      return jsonError(404, "observation_not_found", "Session or observation was not found.");
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
