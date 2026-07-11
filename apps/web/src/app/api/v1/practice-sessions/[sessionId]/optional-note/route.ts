import { aiPipelineService } from "@/server/services/ai-pipeline-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../http";
type Context={params:Promise<{sessionId:string}>};
export async function PUT(request:Request,context:Context){try{const auth=await requireApiTermsAccepted();const {sessionId}=await context.params;return jsonResponse(await aiPipelineService.saveOptionalNote(sessionId,auth.userId,await request.json()));}catch(error){return handleApiError(error)}}
