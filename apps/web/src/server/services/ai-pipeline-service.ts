import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppConfig } from "@/lib/config/env";
import { loadAiServiceConfig } from "@/server/ai/config";
import { createAiTransport, AiServiceError } from "@/server/ai/transport";
import { createAiPipelineService, AiPipelineError } from "@/server/ai-pipeline-service-core.js";
import { AiPipelinePersistenceError, supabaseAiPipelineRepository as repository } from "@/server/repositories/supabase-ai-pipeline-repository";
import { getCurrentConsentVersions, requireCurrentAiProcessingConsent } from "./auth-context";
import { coachSessionService } from "./coach-session-service";

export { AiPipelineError, createAiPipelineService };

export const aiPipelineService = Object.freeze(createAiPipelineService({
  repository,
  createAiTransport,
  loadAiServiceConfig,
  requireCurrentAiProcessingConsent,
  getCurrentConsentVersions,
  coachSessionService,
  createSupabaseAdminClient,
  getAppConfig,
  isAiServiceError: (error) => error instanceof AiServiceError,
  isPersistenceError: (error) => error instanceof AiPipelinePersistenceError,
  createServiceError: (stage, code, status, retryable) => new AiServiceError(stage, code, status, retryable),
}));
