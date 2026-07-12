import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";

type RouteContext = {
  params: Promise<{
    uploadIntentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { uploadIntentId } = await context.params;
    const payload = await request.json();
    if (typeof payload.durationMs !== "number" || !Number.isInteger(payload.durationMs) || payload.durationMs < 1 || payload.durationMs > 180_000) {
      return jsonResponse({ error: { code: "validation_error", message: "durationMs must be an integer from 1 to 180000." } }, { status: 400 });
    }
    const result = await actingCoachService.finalizeUploadIntent(uploadIntentId, payload, auth.userId);
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
