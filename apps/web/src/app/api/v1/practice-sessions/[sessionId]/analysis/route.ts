import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";
import { readBoundedJson } from "@/server/http/bounded-json";
type Context = { params: Promise<{ sessionId: string }> };
export const runtime = "nodejs";
export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireApiTermsAccepted();
    const { sessionId } = await context.params;
    const result = await actingCoachService.retryAnalysis(
      sessionId,
      await readBoundedJson(request),
      auth.userId,
    );
    return jsonResponse(result.value, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
