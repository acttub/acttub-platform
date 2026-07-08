import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { coachSessionService } from "@/server/services/coach-session-service";
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
    const result = coachSessionService.finalizeUploadIntent(
      uploadIntentId,
      payload,
      auth.userId,
    );
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
