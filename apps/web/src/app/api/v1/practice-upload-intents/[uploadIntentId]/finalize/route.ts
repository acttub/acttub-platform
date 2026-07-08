import { coachSessionService } from "@/server/services/coach-session-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonError, jsonResponse } from "../../../http";

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
    const result = coachSessionService.finalizeUploadIntent(uploadIntentId, payload, auth.userId);

    if (!result) {
      return jsonError(404, "upload_intent_not_found", "Upload intent was not found.");
    }

    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
