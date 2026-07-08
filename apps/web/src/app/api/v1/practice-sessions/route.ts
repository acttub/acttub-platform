import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError, jsonResponse } from "../http";

export async function GET() {
  return jsonResponse(coachSessionService.listSessions());
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = coachSessionService.createSession(payload);
    return jsonResponse(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
