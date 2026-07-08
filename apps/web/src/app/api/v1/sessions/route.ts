import { NextResponse } from "next/server";
import { coachSessionService } from "@/server/services/coach-session-service";
import { handleApiError } from "./http";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = coachSessionService.createSession(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
