import { coachSessionService } from "@/server/services/coach-session-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError } from "./http";
import { jsonResponse } from "../http";

export async function POST(request: Request) {
  try {
    const auth = await requireApiTermsAccepted();
    const payload = await request.json();
    const result = coachSessionService.createSession(payload, auth.userId);
    return jsonResponse(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
