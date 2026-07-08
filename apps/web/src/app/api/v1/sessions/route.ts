import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { coachSessionService } from "@/server/services/coach-session-service";
import { requireTermsAccepted } from "@/server/services/auth-context";
import { handleApiError } from "./http";

export async function POST(request: Request) {
  try {
    const auth = await requireTermsAccepted();
    const payload = await request.json();
    const result = coachSessionService.createSession(payload, auth.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
