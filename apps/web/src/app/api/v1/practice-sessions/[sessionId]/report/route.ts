import { actingCoachService } from "@/server/services/acting-coach-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(_: Request, context: Context) { try { const auth = await requireApiTermsAccepted(); const { sessionId } = await context.params; return jsonResponse(await actingCoachService.getReport(sessionId, auth.userId)); } catch (error) { return handleApiError(error); } }
export async function POST(request: Request, context: Context) { try { const auth = await requireApiTermsAccepted(); const { sessionId } = await context.params; const result = await actingCoachService.createReport(sessionId, await request.json(), auth.userId); return jsonResponse(result.value, { status: result.replayed ? 200 : 201 }); } catch (error) { return handleApiError(error); } }
