import { ApiValidationError, coachSessionService } from "@/server/services/coach-session-service";
import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../http";
import { readBoundedJson } from "@/server/http/bounded-json";
import { parsePracticeSessionListQuery, PracticeSessionListValidationError } from "@/server/services/practice-session-list-pagination";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireApiTermsAccepted();
    let query;
    try {
      query = parsePracticeSessionListQuery(new URL(request.url).searchParams);
    } catch (error) {
      if (error instanceof PracticeSessionListValidationError) {
        throw new ApiValidationError(error.message, error.details);
      }
      throw error;
    }
    return jsonResponse(query
      ? await coachSessionService.listSessionSummaries(auth.userId, query)
      : await coachSessionService.listSessions(auth.userId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiTermsAccepted();
    const payload = await readBoundedJson(request);
    const result = await actingCoachService.createSession(payload, auth.userId);
    return jsonResponse(result.value, { status: result.accepted ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
