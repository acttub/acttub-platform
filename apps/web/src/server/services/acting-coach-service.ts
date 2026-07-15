import "server-only";

import { createHash } from "node:crypto";
import type {
  ActingCoachSessionDto,
  ActingReportDto,
  ActingTurnRequest,
  CreateActingSessionRequest,
  RetryAnalysisRequest,
} from "@/lib/api/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { actingApiClient } from "@/server/acting-api/client";
import { getActingApiConfig } from "@/server/acting-api/config";
import {
  classifyUpstreamFailure,
  upstreamEndpoint,
  type UpstreamOperation,
} from "@/server/acting-api/upstream-response-classification";
import {
  ActingApiResponseError,
  requireCoachResponse,
  requireReportResponse,
  requireSceneSummary,
} from "@/server/acting-api/response-guards";
import {
  SupabaseCoachSessionPersistenceError,
  supabaseCoachSessionRepository,
  type ActingRpcResult,
} from "@/server/repositories/supabase-coach-session-repository";
import { coachSessionService } from "@/server/services/coach-session-service";
import {
  AnalysisSourcePreparationError,
  prepareAnalysisVideoSource,
} from "@/server/services/analysis-source-preparation";
import {
  validateReplyText,
  validateSceneContext,
} from "@/lib/practice/input-limits";

type OperationPhase = "analysis" | "coach" | "report";
type OutcomeCode =
  | "analysis_outcome_unknown"
  | "upstream_outcome_unknown"
  | "report_outcome_unknown";
type CauseCode =
  | "acting_api_timeout"
  | "acting_api_unavailable"
  | "acting_api_invalid_response";
type ClaimKind =
  | "claimed"
  | "replay_completed"
  | "replay_failed"
  | "in_progress"
  | "outcome_unknown";

type Claim = {
  kind: ClaimKind;
  operationId: string;
  leaseToken: string;
  sessionId: string;
  runId: string;
  actorTurnId: string;
  privateActingSessionId: string;
  safeErrorCode?: string;
  source?: Record<string, unknown>;
  summaryPayload?: unknown;
  coachContext?: Record<string, unknown>;
  reportPayload?: unknown;
  result?: unknown;
};

type CreatedResult<T> = { value: T; replayed: boolean };

const repository = supabaseCoachSessionRepository;
const compatibilitySceneMedium = "기타";
const compatibilitySceneGenre = "기타";
const causeCodes = new Set<CauseCode>([
  "acting_api_timeout",
  "acting_api_unavailable",
  "acting_api_invalid_response",
]);
const actingSchemaErrorCodes = new Set([
  "42P01",
  "42703",
  "42883",
  "PGRST202",
  "PGRST204",
  "PGRST205",
]);

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asCauseCode = (value: unknown): CauseCode | undefined =>
  typeof value === "string" && causeCodes.has(value as CauseCode)
    ? (value as CauseCode)
    : undefined;

function normalizeClaim(value: ActingRpcResult): Claim {
  const source = asRecord(value.analysis_source ?? value.source);
  const coachContext = asRecord(value.coach_context);
  const kind = asString(value.kind) ?? value.claimState ?? asString(value.claim_state);

  if (!kind || ![
    "claimed",
    "replay_completed",
    "replay_failed",
    "in_progress",
    "outcome_unknown",
  ].includes(kind)) {
    throw new ActingServiceError(500, "internal_error", "Invalid operation claim state.");
  }

  return {
    kind: kind as ClaimKind,
    operationId: value.operationId ?? asString(value.operation_id) ?? "",
    leaseToken: asString(value.leaseToken) ?? asString(value.lease_token) ?? "",
    sessionId: asString(value.sessionId) ?? asString(value.session_id) ?? "",
    runId: asString(value.runId) ?? asString(value.run_id) ?? "",
    actorTurnId: asString(value.actorTurnId) ?? asString(value.actor_turn_id) ?? "",
    privateActingSessionId:
      asString(value.privateActingSessionId) ?? asString(value.acting_session_id) ?? "",
    source: {
      ...asRecord(value.source),
      ...source,
      ...(asString(value.actor_text) ? { actorText: asString(value.actor_text) } : {}),
    },
    summaryPayload: value.summaryPayload ?? value.summary_payload,
    coachContext: asRecord(
      value.coachContext ?? (Object.keys(coachContext).length ? coachContext : undefined),
    ),
    reportPayload: value.reportPayload ?? value.coach_session_payload,
    result: value.result,
    safeErrorCode: asString(value.safeErrorCode) ?? asString(value.safe_error_code),
  };
}

export class ActingServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ActingServiceError";
  }
}

const validationError = (message: string): ActingServiceError =>
  new ActingServiceError(400, "validation_error", message);

const exactBody = (value: unknown, allowedKeys: readonly string[]): Record<string, unknown> => {
  const input = asRecord(value);
  if (Object.keys(input).length === 0 && (typeof value !== "object" || value === null)) {
    throw validationError("Request body must be a JSON object.");
  }
  const unexpected = Object.keys(input).find((key) => !allowedKeys.includes(key));
  if (unexpected) throw validationError(`Unexpected request field: ${unexpected}.`);
  return input;
};

const uuid = (value: unknown, field: string): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw validationError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
};

export const normalizeContext = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError(`${field} is required.`);
  }
  return value.trim().replace(/\s+/gu, " ");
};

const requireActingConfig = (): void => {
  try {
    getActingApiConfig();
  } catch {
    throw new ActingServiceError(
      503,
      "acting_api_not_configured",
      "acting-api is not configured.",
    );
  }
};

const requirePersistenceConfig = (): void => {
  if (!repository.isConfigured() || !createSupabaseAdminClient()) {
    throw new ActingServiceError(
      503,
      "acting_api_not_configured",
      "The acting pipeline is not configured.",
    );
  }
};

const fingerprint = (values: unknown[]): string =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

const operationInput = (userId: string, requestId: unknown, values: unknown[]) => ({
  userId,
  requestId: uuid(requestId, "requestId"),
  requestFingerprint: fingerprint(["acting-api-v1", ...values]),
  operationId: crypto.randomUUID(),
  leaseToken: crypto.randomUUID(),
});

const outcomeCode = (phase: OperationPhase): OutcomeCode => {
  if (phase === "analysis") return "analysis_outcome_unknown";
  if (phase === "report") return "report_outcome_unknown";
  return "upstream_outcome_unknown";
};

const recoveryDetails = (
  phase: OperationPhase,
  causeCode: CauseCode,
  runId?: string,
): Record<string, unknown> => {
  if (phase === "analysis") {
    return { causeCode, retryAllowed: false, action: "create_new_session" };
  }
  if (phase === "report") {
    return { causeCode, retryAllowed: false, action: "contact_support" };
  }
  return {
    causeCode,
    retryAllowed: false,
    action: "restart_interview",
    ...(runId ? { runId } : {}),
  };
};

const ambiguousError = (
  phase: OperationPhase,
  causeCode: CauseCode,
  runId?: string,
): ActingServiceError =>
  new ActingServiceError(
    409,
    outcomeCode(phase),
    "The upstream outcome is unknown.",
    recoveryDetails(phase, causeCode, runId),
  );

const expiredError = (runId: string): ActingServiceError =>
  new ActingServiceError(409, "acting_session_expired", "The acting session expired.", {
    action: "restart_interview",
    runId,
  });

const statusForStableCode = (code: string): number => {
  if (code === "acting_api_rate_limited") return 429;
  if (code === "source_video_unavailable") return 503;
  if (
    code === "acting_api_auth_failed" ||
    code === "acting_api_rejected" ||
    code === "acting_api_contract_mismatch"
  ) return 502;
  if (code === "video_too_large") return 413;
  return 409;
};

const replayError = (
  claim: Claim,
  phase: OperationPhase,
  runId?: string,
): never => {
  if (claim.kind === "in_progress") {
    throw new ActingServiceError(
      409,
      "operation_in_progress",
      "An upstream operation is already in progress.",
    );
  }

  const persisted = asRecord(claim.result);
  const persistedError = asRecord(persisted.error);
  const persistedDetails = asRecord(persistedError.details);
  const persistedCode = asString(persistedError.code);
  const persistedStatus =
    typeof persisted.status === "number" && Number.isInteger(persisted.status)
      ? persisted.status
      : undefined;

  if (claim.kind === "outcome_unknown") {
    const causeCode =
      asCauseCode(persistedDetails.causeCode) ??
      asCauseCode(claim.safeErrorCode) ??
      "acting_api_timeout";
    throw ambiguousError(phase, causeCode, runId || claim.runId);
  }

  const code = persistedCode ?? claim.safeErrorCode ?? "invalid_session_state";
  const details = Object.keys(persistedDetails).length ? persistedDetails : undefined;
  throw new ActingServiceError(
    persistedStatus ?? statusForStableCode(code),
    code,
    asString(persistedError.message) ?? "The prior operation failed.",
    details,
  );
};

async function parseUpstreamResponse(
  response: Response,
  operation: UpstreamOperation,
  runId?: string,
): Promise<unknown> {
  const phase: OperationPhase =
    operation === "analysis" || operation === "report" ? operation : "coach";
  const failure = classifyUpstreamFailure(operation, response.status);

  if (failure) {
    console.error("acting-api upstream request failed", {
      operation,
      endpoint: upstreamEndpoint(operation),
      status: response.status,
    });
  }
  if (failure === "session_expired") throw expiredError(runId ?? "");
  if (failure === "route_not_found") {
    throw new ActingServiceError(
      502,
      "acting_api_rejected",
      "acting-api route was not found.",
    );
  }
  if (failure === "auth_failed") {
    throw new ActingServiceError(
      502,
      "acting_api_auth_failed",
      "acting-api authentication failed.",
    );
  }
  if (failure === "rate_limited") {
    throw new ActingServiceError(
      429,
      "acting_api_rate_limited",
      "acting-api rate limit exceeded.",
    );
  }
  if (failure === "video_too_large") {
    throw new ActingServiceError(413, "video_too_large", "The video is too large.");
  }
  if (failure === "contract_mismatch") {
    throw new ActingServiceError(
      502,
      "acting_api_contract_mismatch",
      "The acting service could not accept this request.",
    );
  }
  if (failure === "request_rejected") {
    throw new ActingServiceError(
      502,
      "acting_api_rejected",
      "acting-api rejected the request.",
    );
  }
  if (failure === "unavailable") {
    throw ambiguousError(phase, "acting_api_unavailable", runId);
  }

  try {
    return await response.json();
  } catch {
    throw ambiguousError(phase, "acting_api_invalid_response", runId);
  }
}

const mapOperationError = (
  error: unknown,
  phase: OperationPhase,
  runId?: string,
): ActingServiceError => {
  if (error instanceof ActingServiceError) return error;
  if (error instanceof AnalysisSourcePreparationError) {
    return new ActingServiceError(
      503,
      error.code,
      error.message,
      { retryAllowed: true, action: "retry_analysis" },
    );
  }
  if (error instanceof ActingApiResponseError) {
    return ambiguousError(phase, error.causeCode, runId);
  }
  const timedOut =
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError");
  return ambiguousError(
    phase,
    timedOut ? "acting_api_timeout" : "acting_api_unavailable",
    runId,
  );
};

const knownRepositoryError = (
  error: unknown,
  phase: OperationPhase,
  runId?: string,
): ActingServiceError | null => {
  if (!(error instanceof SupabaseCoachSessionPersistenceError)) return null;
  const message = error.message;
  if (error.code && actingSchemaErrorCodes.has(error.code)) {
    return new ActingServiceError(
      503,
      "acting_pipeline_not_ready",
      "연기 분석 서버 설정이 아직 완료되지 않았어요.",
      { dependency: "supabase_schema" },
    );
  }
  if (message.includes("request_id_conflict")) {
    return new ActingServiceError(409, "request_id_conflict", "requestId was already used.");
  }
  if (message.includes("operation_in_progress") || message.includes("duplicate key")) {
    return new ActingServiceError(
      409,
      "operation_in_progress",
      "An upstream operation is already in progress.",
    );
  }
  if (message.includes("report_outcome_unknown")) {
    return ambiguousError("report", "acting_api_timeout");
  }
  if (message.includes("upstream_outcome_unknown")) {
    return ambiguousError(phase, "acting_api_unavailable", runId);
  }
  if (
    /invalid_session|invalid_run|start_not_allowed|restart_not_allowed|retry_actor_not_eligible|stale_ai_turn|coach_reply_pending|upload_intent_invalid/u.test(
      message,
    )
  ) {
    return new ActingServiceError(
      409,
      "invalid_session_state",
      "The requested operation is not valid for the current session state.",
    );
  }
  if (message.includes("invalid_duration")) {
    return validationError("durationMs must be an integer from 1 to 180000.");
  }
  return null;
};

async function claimOperation(
  phase: OperationPhase,
  operation: () => Promise<ActingRpcResult>,
  runId?: string,
): Promise<Claim> {
  try {
    return normalizeClaim(await operation());
  } catch (error) {
    throw knownRepositoryError(error, phase, runId) ?? error;
  }
}

const ownedSession = async (
  userId: string,
  sessionId: string,
): Promise<ActingCoachSessionDto> => {
  const result = await repository.getOwnedSession(userId, sessionId);
  if (!result) {
    throw new ActingServiceError(404, "session_not_found", "Session was not found.");
  }
  if (result.pipelineVersion !== "acting-api-v1") {
    throw new ActingServiceError(
      409,
      "invalid_session_state",
      "Legacy sessions are read-only.",
    );
  }
  return result;
};

async function retryLocalCommit(operation: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const isDefinitive = (error: ActingServiceError): boolean =>
  [
    "acting_api_auth_failed",
    "acting_api_rate_limited",
    "acting_api_rejected",
    "acting_api_contract_mismatch",
    "source_video_unavailable",
    "video_too_large",
  ].includes(error.code);

const persistedFailureCode = (error: ActingServiceError): string =>
  isDefinitive(error)
    ? error.code
    : asCauseCode(error.details?.causeCode) ?? "acting_api_unavailable";

async function runAnalysisClaim(
  claim: Claim,
  userId: string,
  sessionId: string,
): Promise<ActingCoachSessionDto> {
  const source = claim.source ?? {};
  let localCommitStarted = false;

  try {
    const video = await prepareAnalysisVideoSource(source, {
      createAdminClient: createSupabaseAdminClient,
      fetchVideo: fetch,
    });

    const response = await actingApiClient.summarize({
      situation: String(source.situation),
      character: String(source.characterContext),
      subtext: String(source.subtext),
      video,
      fileName: String(source.fileName ?? "take.mp4"),
      mimeType: String(source.mimeType),
    });
    const summary = requireSceneSummary(
      await parseUpstreamResponse(response, "analysis"),
    );
    const sceneSummaryId = crypto.randomUUID();
    localCommitStarted = true;
    await retryLocalCommit(() =>
      repository.completeAnalysis({
        userId,
        sessionId,
        operationId: claim.operationId,
        leaseToken: claim.leaseToken,
        sceneSummaryId,
        summaryPayload: summary,
      }),
    );
    return ownedSession(userId, sessionId);
  } catch (error) {
    const mapped = mapOperationError(error, "analysis");
    if (localCommitStarted) throw knownRepositoryError(error, "analysis") ?? mapped;
    try {
      await repository.failAnalysis({
        userId,
        sessionId,
        operationId: claim.operationId,
        leaseToken: claim.leaseToken,
        failureClass: isDefinitive(mapped) ? "definitive" : "ambiguous",
        safeErrorCode: persistedFailureCode(mapped),
      });
    } catch (persistenceError) {
      throw knownRepositoryError(persistenceError, "analysis") ?? mapped;
    }
    throw mapped;
  }
}

const completedSessionKeys = ["id", "userId", "pipelineVersion", "legacy", "status", "medium", "genre", "situation", "characterContext", "subtext", "hiddenAt", "createdAt", "updatedAt", "take", "sceneSummary", "currentRun", "turns", "report"] as const;
const completedReportKeys = ["headline", "biggestProblem", "evidence", "selfDiscovery", "encouragement", "nextStep", "comparison", "reportCount"] as const;
const privateReplayKeys = new Set(["actingSessionId", "privateActingSessionId", "leaseToken", "storagePath", "storageBucket", "signedUrl", "operationId"]);

function requireCompletedResult<T>(value: unknown, keys: readonly string[]): T {
  const result = asRecord(value);
  if (!keys.every((key) => key in result) || Object.keys(result).some((key) => !keys.includes(key))) {
    throw new ActingServiceError(500, "internal_error", "Invalid completed replay result.");
  }
  const stack: unknown[] = [result];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) stack.push(...current);
    else if (current && typeof current === "object") {
      for (const [key, nested] of Object.entries(current)) {
        if (privateReplayKeys.has(key)) throw new ActingServiceError(500, "internal_error", "Unsafe completed replay result.");
        stack.push(nested);
      }
    }
  }
  return result as T;
}

const replaySession = async (
  claim: Claim,
  phase: "analysis" | "coach",
  userId: string,
  sessionId: string,
  runId?: string,
): Promise<ActingCoachSessionDto> => {
  if (claim.kind === "replay_completed") return requireCompletedResult<ActingCoachSessionDto>(claim.result, completedSessionKeys);
  return replayError(claim, phase, runId);
};

const requireStoredReply = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw ambiguousError("coach", "acting_api_invalid_response");
  }
  return value;
};

export const actingCoachService = {
  async finalizeUploadIntent(uploadIntentId: string, payload: unknown, userId: string) {
    requirePersistenceConfig();
    const input = exactBody(payload, ["storagePath", "durationMs"]);
    const durationMs = input.durationMs;
    if (
      typeof durationMs !== "number" ||
      !Number.isInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > 180_000
    ) {
      throw validationError("durationMs must be an integer from 1 to 180000.");
    }
    const verified = await coachSessionService.finalizeUploadIntent(
      uploadIntentId,
      input,
      userId,
    );
    try {
      await repository.finalizeActingUploadIntent({
        uploadIntentId,
        userId,
        storagePath: verified.storagePath,
        durationMs,
      });
    } catch (error) {
      throw knownRepositoryError(error, "analysis") ?? error;
    }
    return { ...verified, durationMs };
  },

  async createSession(
    payload: unknown,
    userId: string,
  ): Promise<CreatedResult<ActingCoachSessionDto>> {
    requireActingConfig();
    requirePersistenceConfig();
    const input = exactBody(payload, [
      "requestId",
      "uploadIntentId",
      "situation",
      "characterContext",
      "subtext",
      // Rolling-deploy compatibility only. Old clients may still send these;
      // active processing ignores them and never forwards them upstream.
      "medium",
      "genre",
    ]) as CreateActingSessionRequest;
    const uploadIntentId = uuid(input.uploadIntentId, "uploadIntentId");
    const { situation, characterContext, subtext } = validateSceneContext(input);
    const intent = await repository.findUploadIntent(uploadIntentId, userId);
    if (!intent || intent.status !== "finalized") {
      throw new ActingServiceError(
        409,
        "invalid_session_state",
        "Upload intent must be finalized.",
      );
    }
    const sessionId = intent.sessionId;
    const claim = await claimOperation("analysis", () =>
      repository.createAnalysisClaim({
        ...operationInput(userId, input.requestId, [
          "create",
          uploadIntentId,
          situation,
          characterContext,
          subtext,
        ]),
        uploadIntentId,
        sessionId,
        takeId: crypto.randomUUID(),
        medium: compatibilitySceneMedium,
        genre: compatibilitySceneGenre,
        situation,
        characterContext,
        subtext,
        leaseSeconds: 780,
      }),
    );
    if (claim.kind !== "claimed") {
      return {
        value: await replaySession(claim, "analysis", userId, claim.sessionId || sessionId),
        replayed: true,
      };
    }
    return {
      value: await runAnalysisClaim(claim, userId, sessionId),
      replayed: false,
    };
  },

  async retryAnalysis(
    sessionId: string,
    payload: unknown,
    userId: string,
  ): Promise<ActingCoachSessionDto> {
    requireActingConfig();
    requirePersistenceConfig();
    const input = exactBody(payload, ["operation", "requestId"]) as RetryAnalysisRequest;
    if (input.operation !== "retry") {
      throw validationError("operation must be retry.");
    }
    const sid = uuid(sessionId, "sessionId");
    const claim = await claimOperation("analysis", () =>
      repository.claimAnalysisRetry({
        ...operationInput(userId, input.requestId, ["analysis_retry", sid]),
        sessionId: sid,
        leaseSeconds: 780,
      }),
    );
    if (claim.kind !== "claimed") {
      return replaySession(claim, "analysis", userId, sid);
    }
    return runAnalysisClaim(claim, userId, sid);
  },

  async turn(
    sessionId: string,
    payload: unknown,
    userId: string,
  ): Promise<ActingCoachSessionDto> {
    requireActingConfig();
    requirePersistenceConfig();
    const raw = asRecord(payload);
    const operation = raw.operation;
    if (!["start", "restart", "reply", "retry_reply"].includes(String(operation))) {
      throw validationError("operation is invalid.");
    }
    const sid = uuid(sessionId, "sessionId");

    if (operation === "start" || operation === "restart") {
      const input = exactBody(payload, ["operation", "requestId"]) as Extract<
        ActingTurnRequest,
        { operation: "start" | "restart" }
      >;
      const runId = crypto.randomUUID();
      const claim = await claimOperation(
        "coach",
        () =>
          repository.claimCoachStart({
            ...operationInput(userId, input.requestId, [input.operation, sid]),
            sessionId: sid,
            runId,
            leaseSeconds: 120,
            restart: input.operation === "restart",
          }),
        runId,
      );
      const claimedRunId = claim.runId || runId;
      if (claim.kind !== "claimed") {
        return replaySession(claim, "coach", userId, sid, claimedRunId);
      }

      let localCommitStarted = false;
      try {
        const response = requireCoachResponse(
          await parseUpstreamResponse(
            await actingApiClient.start({
              summary: claim.summaryPayload,
              subtext: {
                situation: claim.coachContext?.situation,
                character: claim.coachContext?.characterContext,
                subtext: claim.coachContext?.subtext,
              },
            }),
            "coach_start",
            claimedRunId,
          ),
        );
        const aiTurnId = crypto.randomUUID();
        localCommitStarted = true;
        await retryLocalCommit(() =>
          repository.completeCoachTurn({
            userId,
            sessionId: sid,
            runId: claimedRunId,
            operationId: claim.operationId,
            leaseToken: claim.leaseToken,
            actingSessionId: response.session_id,
            aiTurnId,
            question: response.utterance,
            action: response.action,
            focusTimestamp: response.focus_timestamp,
            done: response.done,
            closeReason: response.reason ?? "",
            responsePayload: response,
          }),
        );
        return ownedSession(userId, sid);
      } catch (error) {
        const mapped = mapOperationError(error, "coach", claimedRunId);
        if (localCommitStarted) throw knownRepositoryError(error, "coach", claimedRunId) ?? mapped;
        try {
          await repository.failCoachOperation({
            userId,
            sessionId: sid,
            runId: claimedRunId,
            operationId: claim.operationId,
            leaseToken: claim.leaseToken,
            failureClass: isDefinitive(mapped) ? "definitive" : "ambiguous",
            safeErrorCode: persistedFailureCode(mapped),
          });
        } catch (persistenceError) {
          throw knownRepositoryError(persistenceError, "coach", claimedRunId) ?? mapped;
        }
        throw mapped;
      }
    }

    const allowedKeys =
      operation === "reply"
        ? ["operation", "runId", "requestId", "text", "expectedAiTurnId"]
        : ["operation", "runId", "requestId", "actorTurnId"];
    const input = exactBody(payload, allowedKeys) as Extract<
      ActingTurnRequest,
      { operation: "reply" | "retry_reply" }
    >;
    const runId = uuid(input.runId, "runId");
    const text = input.operation === "reply" ? validateReplyText(input.text) : undefined;
    const expectedAiTurnId = input.operation === "reply" && input.expectedAiTurnId
      ? uuid(input.expectedAiTurnId, "expectedAiTurnId")
      : null;
    const actorTurnId =
      input.operation === "retry_reply"
        ? uuid(input.actorTurnId, "actorTurnId")
        : crypto.randomUUID();
    const claim = await claimOperation(
      "coach",
      () =>
        repository.claimCoachReply({
          ...operationInput(userId, input.requestId, [
            input.operation,
            sid,
            runId,
            ...(text ? [text] : [actorTurnId]),
            ...(expectedAiTurnId ? [expectedAiTurnId] : []),
          ]),
          sessionId: sid,
          runId,
          actorTurnId,
          actorText: text ?? "",
          retryActorTurnId: input.operation === "retry_reply" ? actorTurnId : null,
          leaseSeconds: 120,
          expectedAiTurnId,
        }),
      runId,
    );
    if (claim.kind !== "claimed") {
      return replaySession(claim, "coach", userId, sid, runId);
    }

    const storedText = requireStoredReply(claim.source?.actorText ?? text);
    let localCommitStarted = false;
    try {
      const response = requireCoachResponse(
        await parseUpstreamResponse(
          await actingApiClient.reply({
            session_id: claim.privateActingSessionId,
            text: storedText,
          }),
          "coach_reply",
          runId,
        ),
        claim.privateActingSessionId,
      );
      const aiTurnId = crypto.randomUUID();
      localCommitStarted = true;
      await retryLocalCommit(() =>
        repository.completeCoachTurn({
          userId,
          sessionId: sid,
          runId,
          operationId: claim.operationId,
          leaseToken: claim.leaseToken,
          actingSessionId: response.session_id,
          aiTurnId,
          question: response.utterance,
          action: response.action,
          focusTimestamp: response.focus_timestamp,
          done: response.done,
          closeReason: response.reason ?? "",
          responsePayload: response,
        }),
      );
      return ownedSession(userId, sid);
    } catch (error) {
      const mapped = mapOperationError(error, "coach", runId);
      if (localCommitStarted) throw knownRepositoryError(error, "coach", runId) ?? mapped;
      try {
        if (mapped.code === "acting_session_expired") {
          await repository.expireCoachRun({
            userId,
            sessionId: sid,
            runId,
            operationId: claim.operationId,
            leaseToken: claim.leaseToken,
            actorTurnId,
          });
        } else {
          await repository.failCoachOperation({
            userId,
            sessionId: sid,
            runId,
            operationId: claim.operationId,
            leaseToken: claim.leaseToken,
            actorTurnId,
            failureClass: isDefinitive(mapped) ? "definitive" : "ambiguous",
            safeErrorCode: persistedFailureCode(mapped),
          });
        }
      } catch (persistenceError) {
        throw knownRepositoryError(persistenceError, "coach", runId) ?? mapped;
      }
      throw mapped;
    }
  },

  async getReport(sessionId: string, userId: string): Promise<ActingReportDto> {
    const report = await repository.getOwnedReport(userId, uuid(sessionId, "sessionId"));
    if (!report) {
      throw new ActingServiceError(404, "report_not_found", "Report was not found.");
    }
    return report as ActingReportDto;
  },

  async createReport(
    sessionId: string,
    payload: unknown,
    userId: string,
  ): Promise<CreatedResult<ActingReportDto>> {
    requireActingConfig();
    requirePersistenceConfig();
    const input = exactBody(payload, ["requestId"]);
    const sid = uuid(sessionId, "sessionId");
    const claim = await claimOperation("report", () =>
      repository.claimReport({
        ...operationInput(userId, input.requestId, ["report", sid]),
        sessionId: sid,
        leaseSeconds: 120,
      }),
    );
    if (claim.kind !== "claimed") {
      if (claim.kind === "replay_completed") {
        return { value: requireCompletedResult<ActingReportDto>(claim.result, completedReportKeys), replayed: true };
      }
      replayError(claim, "report");
    }

    let localCommitStarted = false;
    try {
      const response = requireReportResponse(
        await parseUpstreamResponse(
          await actingApiClient.report(claim.reportPayload),
          "report",
        ),
        userId,
      );
      const reportId = crypto.randomUUID();
      localCommitStarted = true;
      await retryLocalCommit(() =>
        repository.completeReport({
          userId,
          sessionId: sid,
          operationId: claim.operationId,
          leaseToken: claim.leaseToken,
          reportId,
          reportPayload: response.report,
          reportCount: response.report_count,
          responsePayload: response,
        }),
      );
      return { value: await this.getReport(sid, userId), replayed: false };
    } catch (error) {
      const mapped = mapOperationError(error, "report");
      if (localCommitStarted) throw knownRepositoryError(error, "report") ?? mapped;
      try {
        await repository.failReport({
          userId,
          sessionId: sid,
          operationId: claim.operationId,
          leaseToken: claim.leaseToken,
          failureClass: isDefinitive(mapped) ? "definitive" : "ambiguous",
          safeErrorCode: persistedFailureCode(mapped),
        });
      } catch (persistenceError) {
        throw knownRepositoryError(persistenceError, "report") ?? mapped;
      }
      throw mapped;
    }
  },
};
