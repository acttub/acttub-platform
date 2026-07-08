import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { jsonError } from "../http";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  const auth = await requireTermsAccepted();
  const { sessionId } = await context.params;
  const session = coachSessionService.getSession(sessionId, auth.userId);

    if (!session) {
      return jsonError(404, "session_not_found", "Session was not found.");
    }

    return jsonResponse({ session });
  } catch (error) {
    return handleApiError(error);
  }
}
