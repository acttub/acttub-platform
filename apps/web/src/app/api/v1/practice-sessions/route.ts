import { coachSessionService } from "@/server/services/coach-session-service";
import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../http";
import { readBoundedJson } from "@/server/http/bounded-json";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const auth = await requireApiTermsAccepted();
    return jsonResponse(await coachSessionService.listSessions(auth.userId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiTermsAccepted();
    const payload = await readBoundedJson(request);
    const result = await actingCoachService.createSession(payload, auth.userId);
    return jsonResponse(result.value, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
