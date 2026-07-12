import "server-only";

import { createHash } from "node:crypto";
import type {
  ActingCoachSessionDto,
  ActingReportDto,
  ActingTurnRequest,
  CreateActingSessionRequest,
  RetryAnalysisRequest,
  SceneGenre,
  SceneMedium,
} from "@/lib/api/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { actingApiClient } from "@/server/acting-api/client";
import { getActingApiConfig } from "@/server/acting-api/config";
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
const causeCodes = new Set<CauseCode>([
  "acting_api_timeout",
  "acting_api_unavailable",
  "acting_api_invalid_response",
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

const normalizeReply = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError("text is required.");
  }
  return value.trim();
};

const sceneMediums = new Set<SceneMedium>([
  "연극",
  "영화",
  "TV 드라마",
  "웹드라마",
  "뮤지컬",
  "기타",
]);
const sceneGenres = new Set<SceneGenre>([
  "드라마",
  "코미디",
  "로맨스",
  "스릴러",
  "액션",
  "판타지",
  "기타",
]);

const exactEnum = <T extends string>(
  value: unknown,
  field: string,
  allowed: Set<T>,
): T => {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw validationError(`${field} is invalid.`);
  }
  return value as T;
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
  if (code === "acting_api_auth_failed" || code === "acting_api_rejected") return 502;
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
  phase: OperationPhase,
  runId?: string,
): Promise<unknown> {
  if (phase === "coach" && response.status === 404) throw expiredError(runId ?? "");
  if (response.status === 401) {
    throw new ActingServiceError(
      502,
      "acting_api_auth_failed",
      "acting-api authentication failed.",
    );
  }
  if (response.status === 429) {
    throw new ActingServiceError(
      429,
      "acting_api_rate_limited",
      "acting-api rate limit exceeded.",
    );
  }
  if (response.status === 413 && phase === "analysis") {
    throw new ActingServiceError(413, "video_too_large", "The video is too large.");
  }
  if (response.status === 400 || response.status === 413) {
    throw new ActingServiceError(
      502,
      "acting_api_rejected",
      "acting-api rejected the request.",
    );
  }
  if (!response.ok) throw ambiguousError(phase, "acting_api_unavailable", runId);

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
    /invalid_session|invalid_run|start_not_allowed|restart_not_allowed|retry_actor_not_eligible|upload_intent_invalid/u.test(
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

  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw ambiguousError("analysis", "acting_api_unavailable");
    }
    const signed = await admin.storage
      .from(String(source.storageBucket))
      .createSignedUrl(String(source.storagePath), 900);
    if (signed.error || !signed.data?.signedUrl) {
      throw ambiguousError("analysis", "acting_api_unavailable");
    }

    const video = await fetch(signed.data.signedUrl);
    if (!video.ok || !video.body) {
      throw ambiguousError("analysis", "acting_api_unavailable");
    }

    const response = await actingApiClient.summarize({
      situation: String(source.formattedSituation),
      character: String(source.characterContext),
      subtext: String(source.subtext),
      video: video.body,
      fileName: String(source.fileName ?? "take.mp4"),
      mimeType: String(source.mimeType),
    });
    const summary = requireSceneSummary(
      await parseUpstreamResponse(response, "analysis"),
    );
    const sceneSummaryId = crypto.randomUUID();
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

const replaySession = async (
  claim: Claim,
  phase: "analysis" | "coach",
  userId: string,
  sessionId: string,
  runId?: string,
): Promise<ActingCoachSessionDto> => {
  if (claim.kind === "replay_completed") return ownedSession(userId, sessionId);
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
      "medium",
      "genre",
      "situation",
      "characterContext",
      "subtext",
    ]) as CreateActingSessionRequest;
    const uploadIntentId = uuid(input.uploadIntentId, "uploadIntentId");
    const medium = exactEnum(input.medium, "medium", sceneMediums);
    const genre = exactEnum(input.genre, "genre", sceneGenres);
    const situation = normalizeContext(input.situation, "situation");
    const characterContext = normalizeContext(input.characterContext, "characterContext");
    const subtext = normalizeContext(input.subtext, "subtext");
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
          medium,
          genre,
          situation,
          characterContext,
          subtext,
        ]),
        uploadIntentId,
        sessionId,
        takeId: crypto.randomUUID(),
        medium,
        genre,
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

      try {
        const response = requireCoachResponse(
          await parseUpstreamResponse(
            await actingApiClient.start({
              summary: claim.summaryPayload,
              subtext: {
                situation: claim.coachContext?.formattedSituation,
                character: claim.coachContext?.characterContext,
                subtext: claim.coachContext?.subtext,
              },
            }),
            "coach",
            claimedRunId,
          ),
        );
        const aiTurnId = crypto.randomUUID();
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
        try {
          if (mapped.code === "acting_session_expired") {
            await repository.expireCoachRun({
              userId,
              sessionId: sid,
              runId: claimedRunId,
              operationId: claim.operationId,
              leaseToken: claim.leaseToken,
            });
          } else {
            await repository.failCoachOperation({
              userId,
              sessionId: sid,
              runId: claimedRunId,
              operationId: claim.operationId,
              leaseToken: claim.leaseToken,
              failureClass: isDefinitive(mapped) ? "definitive" : "ambiguous",
              safeErrorCode: persistedFailureCode(mapped),
            });
          }
        } catch (persistenceError) {
          throw knownRepositoryError(persistenceError, "coach", claimedRunId) ?? mapped;
        }
        throw mapped;
      }
    }

    const allowedKeys =
      operation === "reply"
        ? ["operation", "runId", "requestId", "text"]
        : ["operation", "runId", "requestId", "actorTurnId"];
    const input = exactBody(payload, allowedKeys) as Extract<
      ActingTurnRequest,
      { operation: "reply" | "retry_reply" }
    >;
    const runId = uuid(input.runId, "runId");
    const text = input.operation === "reply" ? normalizeReply(input.text) : undefined;
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
          ]),
          sessionId: sid,
          runId,
          actorTurnId,
          actorText: text ?? "",
          retryActorTurnId: input.operation === "retry_reply" ? actorTurnId : null,
          leaseSeconds: 120,
        }),
      runId,
    );
    if (claim.kind !== "claimed") {
      return replaySession(claim, "coach", userId, sid, runId);
    }

    const storedText = requireStoredReply(claim.source?.actorText ?? text);
    try {
      const response = requireCoachResponse(
        await parseUpstreamResponse(
          await actingApiClient.reply({
            session_id: claim.privateActingSessionId,
            text: storedText,
          }),
          "coach",
          runId,
        ),
        claim.privateActingSessionId,
      );
      const aiTurnId = crypto.randomUUID();
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
        return { value: await this.getReport(sid, userId), replayed: true };
      }
      replayError(claim, "report");
    }

    try {
      const response = requireReportResponse(
        await parseUpstreamResponse(
          await actingApiClient.report(claim.reportPayload),
          "report",
        ),
        userId,
      );
      const reportId = crypto.randomUUID();
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
