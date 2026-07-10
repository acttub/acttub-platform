import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { aiPipelineService } from "@/server/services/ai-pipeline-service";
import { handleApiError, jsonResponse } from "../../http";

export async function POST() {
  try {
    await requireApiTermsAccepted();
    const result = await aiPipelineService.reconcileDeletionAttempts(25);
    return jsonResponse({ processed: result.processed });
  } catch (error) {
    return handleApiError(error);
  }
}
