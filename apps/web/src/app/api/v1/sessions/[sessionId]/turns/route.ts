import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonError } from "../../http";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireTermsAccepted();
    const { sessionId } = await context.params;
    const payload = await request.json();
    const result = coachSessionService.createTurn(sessionId, payload, auth.userId);

    if (!result) {
      return jsonError(404, "session_not_found", "Session was not found.");
    }

    return jsonResponse(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
