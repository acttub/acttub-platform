import { coachSessionService } from "@/server/services/coach-session-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonError, jsonResponse } from "../../http";
import { aiPipelineService } from "@/server/services/ai-pipeline-service";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId } = await context.params;
    try {
      return jsonResponse({ session: await aiPipelineService.getSession(sessionId, auth.userId) });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AiPipelineError" || error.message !== "PIPELINE_SESSION_NOT_FOUND") throw error;
    }
    const session = await coachSessionService.getSession(sessionId, auth.userId);

    if (!session) return jsonError(404, "session_not_found", "Session was not found.");
    return jsonResponse({ session });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request:Request,context:RouteContext){try{const auth=await requireApiTermsAccepted();const {sessionId}=await context.params;const requestId=aiPipelineService.validateRequestId(request.headers.get("Idempotency-Key"));return jsonResponse(await aiPipelineService.deleteSession(sessionId,auth.userId,requestId),{status:202});}catch(error){return handleApiError(error)}}
