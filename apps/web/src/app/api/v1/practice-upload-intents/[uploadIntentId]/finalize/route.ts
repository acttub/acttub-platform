import { NextResponse } from "next/server";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError } from "../../../sessions/http";

type RouteContext = {
  params: Promise<{
    uploadIntentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    await context.params;
    const payload = await request.json();
    const result = coachSessionService.finalizeUploadIntent(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
