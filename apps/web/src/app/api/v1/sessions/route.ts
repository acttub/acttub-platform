import { NextResponse } from "next/server";
import type { CreateSessionResponse } from "@/lib/api/types";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError } from "./http";

export async function POST(request: Request): Promise<NextResponse<CreateSessionResponse>> {
  try {
    const payload = await request.json();
    const result = coachSessionService.createSession(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
