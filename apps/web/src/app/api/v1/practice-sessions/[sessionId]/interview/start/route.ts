import { aiPipelineService } from "@/server/services/ai-pipeline-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../../http";
type Context={params:Promise<{sessionId:string}>};
export async function POST(_request:Request,context:Context){try{const auth=await requireApiTermsAccepted();const {sessionId}=await context.params;return jsonResponse(await aiPipelineService.startInterview(sessionId,auth.userId));}catch(error){return handleApiError(error)}}
