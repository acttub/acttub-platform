import type { createAiTransport } from "./ai/transport";
import type { loadAiServiceConfig } from "./ai/config";
import type { supabaseAiPipelineRepository } from "./repositories/supabase-ai-pipeline-repository";
import type { coachSessionService } from "./services/coach-session-service";
import type { createSupabaseAdminClient } from "../lib/supabase/admin";
import type { getAppConfig } from "../lib/config/env";
import type { getCurrentConsentVersions, requireCurrentAiProcessingConsent } from "./services/auth-context";

export class AiPipelineError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 502 | 503;
  readonly code: string;
  constructor(status: 400 | 403 | 404 | 409 | 502 | 503, code: string);
}
export interface AiPipelineServiceDependencies {
  repository: typeof supabaseAiPipelineRepository;
  createAiTransport: typeof createAiTransport;
  loadAiServiceConfig: typeof loadAiServiceConfig;
  requireCurrentAiProcessingConsent: typeof requireCurrentAiProcessingConsent;
  getCurrentConsentVersions: typeof getCurrentConsentVersions;
  coachSessionService: typeof coachSessionService;
  createSupabaseAdminClient: typeof createSupabaseAdminClient;
  getAppConfig: typeof getAppConfig;
  isAiServiceError?: (error: unknown) => boolean;
  isPersistenceError?: (error: unknown) => boolean;
  createSummaryNetworkError?: () => Error;
}
export interface AiPipelineService {
  createSession(body: unknown, userId: string): Promise<unknown>;
  getSession(sessionId: string, userId: string): Promise<unknown>;
  saveOptionalNote(sessionId: string, userId: string, body: unknown): Promise<unknown>;
  confirmObservation(sessionId: string, observationId: string, userId: string, body: unknown): Promise<unknown>;
  startInterview(sessionId: string, userId: string): Promise<unknown>;
  addTurn(sessionId: string, userId: string, body: unknown): Promise<unknown>;
  stopInterview(sessionId: string, userId: string): Promise<unknown>;
  resumeInterview(sessionId: string, userId: string): Promise<unknown>;
  getReport(sessionId: string, userId: string): Promise<unknown>;
  retryReport(sessionId: string, userId: string): Promise<unknown>;
  validateRequestId(value: string | null): string;
  deleteSession(sessionId: string, userId: string, requestId: string): Promise<unknown>;
  reconcileDeletionAttempts(userId: string, limit?: number): Promise<{ processed: number; results: Array<{ requestId: string; status: "completed" | "failed" }> }>;
  getDeletionStatus(sessionId: string, userId: string, requestId: string): Promise<unknown>;
}
export function createAiPipelineService(deps: AiPipelineServiceDependencies): Readonly<AiPipelineService>;
