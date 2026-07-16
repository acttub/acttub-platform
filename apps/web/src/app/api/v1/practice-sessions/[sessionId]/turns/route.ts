import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId } = await context.params;
    const payload = await request.json();
    const result = await actingCoachService.turn(sessionId, payload, auth.userId);
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
