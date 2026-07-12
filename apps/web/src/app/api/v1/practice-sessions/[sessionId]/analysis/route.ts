import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";
type Context = { params: Promise<{ sessionId: string }> };
export const runtime = "nodejs";
export const maxDuration = 800;
export async function POST(request: Request, context: Context) { try { const auth = await requireApiTermsAccepted(); const { sessionId } = await context.params; return jsonResponse(await actingCoachService.retryAnalysis(sessionId, await request.json(), auth.userId)); } catch (error) { return handleApiError(error); } }
