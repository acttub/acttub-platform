import { aiPipelineService } from "@/server/services/ai-pipeline-service";
import { requireApiTermsAccepted } from "@/server/services/auth-context";
import { handleApiError, jsonResponse } from "../../../../../http";
type Context={params:Promise<{sessionId:string;observationId:string}>};
export async function POST(request:Request,context:Context){try{const auth=await requireApiTermsAccepted();const {sessionId,observationId}=await context.params;return jsonResponse(await aiPipelineService.confirmObservation(sessionId,observationId,auth.userId,await request.json()));}catch(error){return handleApiError(error)}}
