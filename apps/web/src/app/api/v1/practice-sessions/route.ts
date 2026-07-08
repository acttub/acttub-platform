import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../http";

export async function GET() {
  const auth = await requireTermsAccepted();
  return jsonResponse(coachSessionService.listSessions(auth.userId));
}

export async function POST(request: Request) {
  try {
    const auth = await requireTermsAccepted();
    const payload = await request.json();
    const result = coachSessionService.createSession(payload, auth.userId);
    return jsonResponse(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
