import { coachSessionService } from "@/server/services/coach-session-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../http";

export async function POST(request: Request) {
  try {
    const auth = await requireApiTermsAccepted();
    const payload = await request.json();
    const result = await coachSessionService.createUploadIntent(payload, auth.userId);
    return jsonResponse({ uploadIntent: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
