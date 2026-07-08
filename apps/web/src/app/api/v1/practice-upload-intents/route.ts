import { NextResponse } from "next/server";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError } from "../sessions/http";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const uploadIntent = coachSessionService.createUploadIntent(payload);
    return NextResponse.json({ uploadIntent }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
