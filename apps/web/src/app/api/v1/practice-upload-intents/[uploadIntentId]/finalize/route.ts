import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";
import { readBoundedJson } from "@/server/http/bounded-json";

type RouteContext = {
  params: Promise<{
    uploadIntentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiTermsAccepted();
    const { uploadIntentId } = await context.params;
    const payload = await readBoundedJson(request);
    const result = await actingCoachService.finalizeUploadIntent(uploadIntentId, payload, auth.userId);
    return jsonResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
