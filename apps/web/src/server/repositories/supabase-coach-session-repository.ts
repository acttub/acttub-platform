import "server-only";

import type {
  LegacyInternalCoachSessionDto,
  LegacyCoachSessionDto,
  LegacyTakeDto,
  ConfirmationState,
  Medium,
  ObservationDto,
  SessionStatus,
  TurnDto,
  ValidationMetricsDto,
} from "@/lib/api/legacy-types";

import type {
  ActingCoachSessionDto,
  ActingReportDto,
  SceneSummaryDto,
  CoachSessionDto,
  PracticeUploadIntentDto,
  TakeDto,
} from "@/lib/api/types";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export class SupabaseCoachSessionPersistenceError extends Error {
  constructor(
    readonly field: string,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SupabaseCoachSessionPersistenceError";
  }
}

type JsonRecord = Record<string, unknown>;

export type ActingClaimState =
  | "claimed"
  | "replay_completed"
  | "replay_failed"
  | "in_progress"
  | "outcome_unknown";

export type ActingRpcResult = JsonRecord & {
  kind?: ActingClaimState;
  operationId?: string;
  leaseToken?: string;
  claimState?: ActingClaimState;
};

type ActingRpcInput = Record<string, string | number | boolean | null | JsonRecord>;

type StoredUploadIntentRecord = PracticeUploadIntentDto & {
  finalizedVideoUrl?: string;
  finalizedDurationMs?: number | null;
  intent: PracticeUploadIntentDto;
};

const configuredForSupabasePersistence = (): boolean => {
  const config = getAppConfig();
  return config.supabase.isConfigured && config.video.bucket === "practice-videos";
};

const requireSupabaseAdminClient = () => {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new SupabaseCoachSessionPersistenceError(
      "persistence",
      "Supabase service-role persistence is required in configured mode.",
    );
  }

  return admin;
};

const assertNoPersistenceError = (
  error: { code?: string; message?: string } | null | undefined,
  field: string,
  action: string,
): void => {
  if (!error) return;

  throw new SupabaseCoachSessionPersistenceError(
    field,
    `${action}: ${error.message ?? "Supabase persistence failed."}`,
    error.code,
  );
};

const asRecord = (value: unknown): JsonRecord =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : {};

const asArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const number = asNumber(value, Number.NaN);
  return Number.isFinite(number) ? number : null;
};

const asBoolean = (value: unknown): boolean => value === true;

const mapActingRpcResult = (value: unknown): ActingRpcResult => {
  const row = asRecord(Array.isArray(value) ? value[0] : value);
  return {
    ...row,
    operationId: asNullableString(row.operation_id) ?? undefined,
    claimState: asNullableString(row.claim_state) as ActingClaimState | undefined,
  };
};

const callActingRpc = async (name: string, input: ActingRpcInput): Promise<ActingRpcResult> => {
  const admin = requireSupabaseAdminClient();
  const { data, error } = await admin.rpc(name, input);
  assertNoPersistenceError(error, "operation", `Could not execute ${name}`);
  return mapActingRpcResult(data);
};

const normalizeClaim = async (
  value: ActingRpcResult,
  input: { operationId: string; leaseToken: string; sessionId?: string; runId?: string; actorTurnId?: string },
): Promise<ActingRpcResult> => {
  const kind = value.claimState;
  let replayPayload = value.response_payload;
  let replayErrorCode: string | null = null;
  if (kind && kind !== "claimed" && value.operationId) {
    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("practice_upstream_operations")
      .select("response_payload,safe_error_code")
      .eq("id", value.operationId)
      .maybeSingle();
    assertNoPersistenceError(error, "operation", "Could not hydrate replay metadata");
    const replay = asRecord(data);
    replayPayload = replay.response_payload ?? replayPayload;
    replayErrorCode = asNullableString(replay.safe_error_code);
  }
  return {
    ...value,
    kind,
    operationId: value.operationId ?? input.operationId,
    leaseToken: kind === "claimed" ? input.leaseToken : undefined,
    sessionId: asNullableString(value.session_id) ?? input.sessionId,
    runId: asNullableString(value.run_id) ?? input.runId,
    actorTurnId: asNullableString(value.actor_turn_id) ?? input.actorTurnId,
    privateActingSessionId: asNullableString(value.acting_session_id) ?? undefined,
    source: value.analysis_source ?? (value.actor_text ? { actorText: value.actor_text } : undefined),
    summaryPayload: value.summary_payload,
    coachContext: value.coach_context,
    reportPayload: value.coach_session_payload,
    result: replayPayload,
    safeErrorCode: replayErrorCode ?? undefined,
  };
};

const mapDbStatus = (status: unknown): SessionStatus => {
  switch (status) {
    case "questioning":
      return "PROBE_LOOP";
    case "completed":
      return "END";
    case "observations_pending":
    default:
      return "OBSERVE_CONFIRM";
  }
};

const mapObservation = (row: JsonRecord): ObservationDto => ({
  id: asString(row.id),
  takeId: asString(row.take_id),
  timestampStartMs: asNumber(row.timestamp_start_ms),
  timestampEndMs: asNumber(row.timestamp_end_ms),
  observationText: asString(row.observation_text),
  confidence: asNumber(row.confidence),
  confirmationState: asString(row.confirmation_state, "unasked") as ConfirmationState,
  blockedForQuestioning: asBoolean(row.blocked_for_questioning),
  createdAt: asString(row.created_at),
});

const mapTurn = (row: JsonRecord): TurnDto => {
  const speaker = asString(row.speaker) === "actor" ? "actor" : "coach";

  return {
    id: asString(row.id),
    sessionId: asString(row.session_id),
    speaker,
    content: asString(row.content),
    questionFocus: asString(row.question_focus, "missing_context") as TurnDto["questionFocus"],
    sourceObservationIds: Array.isArray(row.source_observation_ids)
      ? row.source_observation_ids.filter((id): id is string => typeof id === "string")
      : [],
    turnState: speaker === "actor" ? "recorded" : "generated",
    createdAt: asString(row.created_at),
  };
};

const mapValidationMetrics = (row: JsonRecord | null): ValidationMetricsDto | null => {
  if (!row) return null;
  const payload = asRecord(row.payload);

  return {
    feltHelpedFindGap1To7: asNullableNumber(payload.feltHelpedFindGap1To7),
    feltJudged1To7: asNullableNumber(payload.feltJudged1To7),
    rejectionSafety1To7: asNullableNumber(payload.rejectionSafety1To7),
    answerability1To7: asNullableNumber(payload.answerability1To7),
    reuseIntent1To7: asNullableNumber(payload.reuseIntent1To7),
    rejectedObservationReuseCount: asNumber(payload.rejectedObservationReuseCount),
    forbiddenLanguageCount: asNumber(payload.forbiddenLanguageCount),
    finalSentenceResult: asString(payload.finalSentenceResult, "empty") as ValidationMetricsDto["finalSentenceResult"],
  };
};

const latestValidationMetricsEvent = (sessionRow: JsonRecord): JsonRecord | null =>
  asArray(sessionRow.validation_events)
    .filter((event) => asString(event.event_type) === "validation_metrics")
    .sort((a, b) => asString(b.created_at).localeCompare(asString(a.created_at)))[0] ?? null;

const mapTake = (sessionRow: JsonRecord): TakeDto => {
  const take = asArray(sessionRow.practice_takes)
    .sort((a, b) => asString(b.created_at).localeCompare(asString(a.created_at)))[0];
  if (!take) {
    throw new SupabaseCoachSessionPersistenceError(
      "sessionId",
      "Supabase session is missing its practice take.",
    );
  }

  return {
    id: asString(take.id),
    sessionId: asString(take.session_id),
    videoUrl: `supabase://${asString(take.storage_bucket)}/${asString(take.storage_path)}`,
    durationMs: asNullableNumber(take.duration_ms),
    analysisStatus: asString(take.analysis_status) === "failed" ? "failed" : "completed",
    analysisError: asNullableString(take.analysis_error),
    createdAt: asString(take.created_at),
  };
};

const mapLegacyTake = (sessionRow: JsonRecord): LegacyTakeDto => {
  const take = asArray(sessionRow.practice_takes)
    .sort((a, b) => asString(b.created_at).localeCompare(asString(a.created_at)))[0];
  if (!take) {
    throw new SupabaseCoachSessionPersistenceError(
      "sessionId",
      "Supabase session is missing its practice take.",
    );
  }

  const analysisStatus = asString(take.analysis_status);
  if (analysisStatus !== "generated" && analysisStatus !== "failed") {
    throw new SupabaseCoachSessionPersistenceError(
      "analysisStatus",
      "Legacy practice take has an invalid analysis status.",
    );
  }

  return {
    id: asString(take.id),
    sessionId: asString(take.session_id),
    videoUrl: `supabase://${asString(take.storage_bucket)}/${asString(take.storage_path)}`,
    durationMs: asNullableNumber(take.duration_ms),
    analysisStatus,
    analysisError: asNullableString(take.analysis_error),
    createdAt: asString(take.created_at),
  };
};

const mapLegacyInternalSession = (row: JsonRecord): LegacyInternalCoachSessionDto => ({
  id: asString(row.id),
  userId: asString(row.user_id),
  status: mapDbStatus(row.status),
  medium: asString(row.medium, "upload_url") as Medium,
  genre: asString(row.genre) as ActingCoachSessionDto["genre"],
  situation: asString(row.situation),
  characterContext: asString(row.character_context),
  subtext: asString(row.subtext),
  finalActorSentence: asNullableString(row.final_actor_sentence),
  hiddenAt: asNullableString(row.hidden_at),
  validationMetrics: mapValidationMetrics(latestValidationMetricsEvent(row)),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
  take: mapTake(row),
  observations: asArray(row.observations)
    .map(mapObservation)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  turns: asArray(row.question_turns)
    .map(mapTurn)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
});

const mapLegacySession = (row: JsonRecord): LegacyCoachSessionDto => ({
  id: asString(row.id),
  userId: asString(row.user_id),
  pipelineVersion: "legacy-gemini-v1",
  legacy: true,
  status: mapDbStatus(row.status) === "END"
    ? "LEGACY_COMPLETED"
    : mapDbStatus(row.status) === "PROBE_LOOP"
      ? "LEGACY_QUESTIONING"
      : "LEGACY_OBSERVATIONS_PENDING",
  medium: asString(row.medium, "upload_url") as Medium,
  genre: asString(row.genre) as ActingCoachSessionDto["genre"],
  situation: asString(row.situation),
  characterContext: asString(row.character_context),
  subtext: asString(row.subtext),
  hiddenAt: asNullableString(row.hidden_at),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
  take: mapLegacyTake(row),
  sceneSummary: null, currentRun: null, turns: [], report: null,
  legacyResult: asArray(row.session_results)[0] ? {
    actorAuthoredSentence: asString(asArray(row.session_results)[0].actor_authored_sentence),
    questionToRevisit: asNullableString(asArray(row.session_results)[0].question_to_revisit),
    createdAt: asString(asArray(row.session_results)[0].created_at),
  } : null,
});

const mapActingReport = (row: JsonRecord): ActingReportDto => {
  const payload = asRecord(row.payload);
  const biggestProblem = asRecord(payload.biggest_problem);
  return {
    headline: asString(payload.headline),
    biggestProblem: {
      start: asString(biggestProblem.start),
      end: asString(biggestProblem.end),
      dimension: asString(biggestProblem.dimension),
      description: asString(biggestProblem.description),
    },
    evidence: asString(payload.evidence),
    selfDiscovery: asString(payload.self_discovery),
    encouragement: asString(payload.encouragement),
    nextStep: asString(payload.next_step),
    comparison: asString(payload.comparison),
    reportCount: asNumber(row.report_count),
  };
};

const mapSceneSummary = (row: JsonRecord): SceneSummaryDto => ({
  ...row,
  observation: asRecord(row.observation),
  summary: asString(row.summary),
  intent_alignment: asString(row.intent_alignment),
  key_moment: asString(row.key_moment),
  key_dimension: asString(row.key_dimension),
  anomalies: asArray(row.anomalies),
});

const mapActingSession = (row: JsonRecord): ActingCoachSessionDto => {
  const takeRow = asArray(row.practice_takes)[0] ?? {};
  const durationMs = asNullableNumber(takeRow.duration_ms);
  if (
    durationMs === null ||
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > 180_000
  ) {
    throw new SupabaseCoachSessionPersistenceError(
      "durationMs",
      "Acting practice take has an invalid duration.",
    );
  }
  const runRows = asArray(row.practice_interview_runs);
  const currentRun = runRows.find((run) => asString(run.id) === asString(row.interview_run_id)) ?? null;
  const turns = asArray(row.practice_turns)
    .filter((turn) => !currentRun || asString(turn.run_id) === asString(currentRun.id))
    .sort((a, b) => asNumber(a.ordinal) - asNumber(b.ordinal));
  const sceneSummary = asArray(row.scene_summaries)[0] ?? null;
  const report = asArray(row.practice_reports)[0] ?? null;
  const runStatus = currentRun ? asString(currentRun.status) : null;
  const recoveryAction = !currentRun
    ? "start"
    : ["expired", "outcome_unknown"].includes(runStatus ?? "")
      ? "restart"
      : runStatus === "start_failed" && asBoolean(currentRun.failure_retryable)
        ? asString(currentRun.start_mode) === "restart" ? "restart" : "start"
        : null;

  const session: ActingCoachSessionDto = {
    id: asString(row.id),
    userId: asString(row.user_id),
    pipelineVersion: "acting-api-v1",
    legacy: false,
    status: asString(row.status).toUpperCase() as ActingCoachSessionDto["status"],
    medium: asString(row.medium) as ActingCoachSessionDto["medium"],
    genre: asString(row.genre) as ActingCoachSessionDto["genre"],
    situation: asString(row.situation),
    characterContext: asString(row.character_context),
    subtext: asString(row.subtext),
    hiddenAt: asNullableString(row.hidden_at),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    take: {
      id: asString(takeRow.id),
      durationMs,
      analysisStatus: asString(takeRow.analysis_status) as ActingCoachSessionDto["take"]["analysisStatus"],
      analysisError: asNullableString(takeRow.analysis_error),
      analysisRetryable: asBoolean(takeRow.analysis_retryable),
      createdAt: asString(takeRow.created_at),
    },
    sceneSummary: sceneSummary ? mapSceneSummary(asRecord(sceneSummary.payload)) : null,
    currentRun: currentRun ? {
      runId: asString(currentRun.id),
      status: asString(currentRun.status) as NonNullable<ActingCoachSessionDto["currentRun"]>["status"],
      closeReason: asNullableString(currentRun.close_reason),
      failureCode: asNullableString(currentRun.failure_code),
      failureRetryable: asBoolean(currentRun.failure_retryable),
      recoveryAction,
    } : null,
    turns: turns.map((turn) => ({
      id: asString(turn.id), runId: asString(turn.run_id), ordinal: asNumber(turn.ordinal),
      role: asString(turn.role) as "ai" | "actor", text: asString(turn.text), action: asNullableString(turn.action) as ActingCoachSessionDto["turns"][number]["action"],
      focusTimestamp: asNullableString(turn.focus_timestamp), deliveryStatus: asString(turn.delivery_status) as "pending" | "completed" | "failed" | "outcome_unknown",
      deliveryRetryable: asBoolean(turn.delivery_retryable),
      deliveryErrorCode: asNullableString(turn.delivery_error_code),
      createdAt: asString(turn.created_at),
    })),
    report: report ? mapActingReport(report) : null,
  };

  return session;
};

const legacySessionSelect = `
  *,
  practice_takes(*),
  observations(*),
  question_turns(*),
  validation_events(*),
  session_results(*)
`;

const actingSessionSelect = `
  *,
  practice_takes(*),
  scene_summaries(*),
  practice_interview_runs:practice_interview_runs!practice_interview_runs_session_id_user_id_fkey(*),
  practice_turns(*),
  practice_reports(*)
`;

const isActingSessionRow = (row: JsonRecord): boolean =>
  asString(row.pipeline_version, "legacy-gemini-v1") === "acting-api-v1";

const mapUploadIntent = (row: JsonRecord): StoredUploadIntentRecord => {
  const config = getAppConfig();
  const mimeType = asString(row.expected_mime_type) as PracticeUploadIntentDto["fileMetadata"]["mimeType"];
  const storageBucket = asString(row.expected_storage_bucket, "practice-videos") as PracticeUploadIntentDto["storageBucket"];
  const uploadIntent: PracticeUploadIntentDto = {
    uploadIntentId: asString(row.id),
    sessionId: asString(row.session_id),
    userId: asString(row.user_id),
    storageBucket,
    storagePath: asString(row.expected_storage_path),
    uploadUrl: `/api/v1/practice-upload-intents/${asString(row.id)}/finalize`,
    fileMetadata: {
      fileName: asString(row.expected_storage_path).split("/").pop() ?? "take.mp4",
      mimeType,
      sizeBytes: asNumber(row.expected_size_bytes),
    },
    status: asString(row.status, "created") as PracticeUploadIntentDto["status"],
    finalizedAt: asNullableString(row.finalized_at),
    constraints: {
      maxUploadBytes: config.video.maxUploadBytes,
      allowedMimeTypes: ["video/mp4", "video/quicktime"],
    },
    expiresAt: asString(row.expires_at),
  };

  return {
    ...uploadIntent,
    finalizedDurationMs: asNullableNumber(row.duration_ms),
    intent: uploadIntent,
  };
};

async function hydrateSession(sessionId: string, userId: string, includeHidden = false): Promise<CoachSessionDto | null> {
  const admin = requireSupabaseAdminClient();
  let legacyQuery = admin
    .from("practice_sessions")
    .select(legacySessionSelect)
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (!includeHidden) legacyQuery = legacyQuery.is("hidden_at", null);

  const { data, error } = await legacyQuery.maybeSingle();
  assertNoPersistenceError(error, "sessionId", "Could not read Supabase practice session");
  if (!data) return null;

  const legacyRow = asRecord(data);
  if (!isActingSessionRow(legacyRow)) return mapLegacySession(legacyRow);

  let actingQuery = admin
    .from("practice_sessions")
    .select(actingSessionSelect)
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (!includeHidden) actingQuery = actingQuery.is("hidden_at", null);

  const { data: actingData, error: actingError } = await actingQuery.maybeSingle();
  assertNoPersistenceError(
    actingError,
    "sessionId",
    "Could not read acting-api practice session",
  );
  return actingData ? mapActingSession(asRecord(actingData)) : null;
}

async function hydrateLegacySession(sessionId: string, userId: string, includeHidden = false): Promise<LegacyInternalCoachSessionDto | null> {
  const admin = requireSupabaseAdminClient();
  let query = admin.from("practice_sessions").select(legacySessionSelect).eq("id", sessionId).eq("user_id", userId);
  if (!includeHidden) query = query.is("hidden_at", null);
  const { data, error } = await query.maybeSingle();
  assertNoPersistenceError(error, "sessionId", "Could not read legacy practice session");
  if (!data) return null;
  const row = asRecord(data);
  if (isActingSessionRow(row)) return null;
  return mapLegacyInternalSession(row);
}

export const supabaseCoachSessionRepository = {
  isConfigured(): boolean {
    return configuredForSupabasePersistence();
  },

  async createUploadIntent(
    uploadIntent: PracticeUploadIntentDto,
    identity?: { requestId: string; requestFingerprint: string },
  ): Promise<PracticeUploadIntentDto> {
    if (!configuredForSupabasePersistence()) return uploadIntent;

    const admin = requireSupabaseAdminClient();
    if (identity) {
      const { data, error } = await admin.rpc("acttub_create_upload_intent", {
        p_user_id: uploadIntent.userId,
        p_request_id: identity.requestId,
        p_request_fingerprint: identity.requestFingerprint,
        p_upload_intent_id: uploadIntent.uploadIntentId,
        p_session_id: uploadIntent.sessionId,
        p_storage_bucket: uploadIntent.storageBucket,
        p_storage_path: uploadIntent.storagePath,
        p_mime_type: uploadIntent.fileMetadata.mimeType,
        p_size_bytes: uploadIntent.fileMetadata.sizeBytes,
        p_expires_at: uploadIntent.expiresAt,
      });
      assertNoPersistenceError(error, "uploadIntentId", "Could not claim Supabase upload intent");
      const row = asRecord(Array.isArray(data) ? data[0] : data);
      const replayed = mapUploadIntent(row).intent;
      return {
        ...replayed,
        fileMetadata: {
          ...replayed.fileMetadata,
          fileName: uploadIntent.fileMetadata.fileName,
        },
      };
    }

    const { error } = await admin
      .from("upload_intents")
      .insert({
        id: uploadIntent.uploadIntentId,
        user_id: uploadIntent.userId,
        session_id: uploadIntent.sessionId,
        status: "created",
        expected_storage_bucket: uploadIntent.storageBucket,
        expected_storage_path: uploadIntent.storagePath,
        expected_mime_type: uploadIntent.fileMetadata.mimeType,
        expected_size_bytes: uploadIntent.fileMetadata.sizeBytes,
        expires_at: uploadIntent.expiresAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(
      error,
      "uploadIntentId",
      "Could not persist Supabase upload intent",
    );
    return uploadIntent;
  },

  async findUploadIntent(
    uploadIntentId: string,
    ownerUserId?: string,
  ): Promise<StoredUploadIntentRecord | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    let query = admin
      .from("upload_intents")
      .select("*")
      .eq("id", uploadIntentId);

    if (ownerUserId) query = query.eq("user_id", ownerUserId);

    const { data, error } = await query.maybeSingle();
    assertNoPersistenceError(error, "uploadIntentId", "Could not read Supabase upload intent");
    return data ? mapUploadIntent(asRecord(data)) : null;
  },

  async finalizeUploadIntent(uploadIntent: PracticeUploadIntentDto): Promise<void> {
    if (!configuredForSupabasePersistence()) return;

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("upload_intents")
      .select("id")
      .eq("id", uploadIntent.uploadIntentId)
      .eq("user_id", uploadIntent.userId)
      .eq("expected_storage_bucket", uploadIntent.storageBucket)
      .eq("expected_storage_path", uploadIntent.storagePath)
      .eq("status", "created")
      .maybeSingle();

    assertNoPersistenceError(
      error,
      "uploadIntentId",
      "Could not verify Supabase upload intent",
    );
    if (!data) {
      throw new SupabaseCoachSessionPersistenceError(
        "uploadIntentId",
        "Could not verify Supabase upload intent: matching created intent was not found.",
      );
    }
  },

  async finalizeActingUploadIntent(input: {
    uploadIntentId: string;
    userId: string;
    storagePath: string;
    durationMs: number;
  }): Promise<ActingRpcResult> {
    return callActingRpc("acttub_finalize_upload_intent", {
      p_upload_intent_id: input.uploadIntentId,
      p_user_id: input.userId,
      p_storage_path: input.storagePath,
      p_duration_ms: input.durationMs,
    });
  },

  async createAnalysisClaim(input: {
    uploadIntentId: string; userId: string; sessionId: string; takeId: string;
    requestId: string; requestFingerprint: string; operationId: string; leaseToken: string;
    medium: string; genre: string; situation: string; characterContext: string; subtext: string;
    leaseSeconds: number; createdAt?: string;
  }): Promise<ActingRpcResult> {
    return await normalizeClaim(await callActingRpc("acttub_create_acting_session", {
      p_upload_intent_id: input.uploadIntentId, p_user_id: input.userId,
      p_session_id: input.sessionId, p_take_id: input.takeId, p_request_id: input.requestId,
      p_request_fingerprint: input.requestFingerprint, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_medium: input.medium, p_genre: input.genre,
      p_situation: input.situation, p_character_context: input.characterContext,
      p_subtext: input.subtext, p_lease_seconds: input.leaseSeconds,
      p_created_at: input.createdAt ?? new Date().toISOString(),
    }), input);
  },

  async claimAnalysisRetry(input: {
    sessionId: string; userId: string; requestId: string; requestFingerprint: string;
    operationId: string; leaseToken: string; leaseSeconds: number;
  }): Promise<ActingRpcResult> {
    return await normalizeClaim(await callActingRpc("acttub_claim_analysis_retry", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_request_id: input.requestId,
      p_request_fingerprint: input.requestFingerprint, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_lease_seconds: input.leaseSeconds,
    }), input);
  },

  async completeAnalysis(input: {
    sessionId: string; userId: string; operationId: string; leaseToken: string;
    sceneSummaryId: string; summaryPayload: JsonRecord;
  }): Promise<void> {
    await callActingRpc("acttub_complete_analysis", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_scene_summary_id: input.sceneSummaryId,
      p_summary_payload: input.summaryPayload,
    });
  },

  async failAnalysis(input: {
    sessionId: string; userId: string; operationId: string; leaseToken: string;
    failureClass: string; safeErrorCode: string;
  }): Promise<void> {
    await callActingRpc("acttub_fail_analysis", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_failure_class: input.failureClass,
      p_safe_error_code: input.safeErrorCode,
    });
  },

  async claimCoachStart(input: {
    sessionId: string; userId: string; requestId: string; requestFingerprint: string;
    operationId: string; runId: string; leaseToken: string; leaseSeconds: number; restart: boolean;
  }): Promise<ActingRpcResult> {
    return await normalizeClaim(await callActingRpc("acttub_claim_coach_start", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_request_id: input.requestId,
      p_request_fingerprint: input.requestFingerprint, p_operation_id: input.operationId,
      p_run_id: input.runId, p_lease_token: input.leaseToken,
      p_lease_seconds: input.leaseSeconds, p_restart: input.restart,
    }), input);
  },

  async claimCoachReply(input: {
    sessionId: string; userId: string; runId: string; requestId: string;
    requestFingerprint: string; operationId: string; actorTurnId: string; actorText: string;
    retryActorTurnId?: string | null; leaseToken: string; leaseSeconds: number;
    expectedAiTurnId?: string | null;
  }): Promise<ActingRpcResult> {
    return await normalizeClaim(await callActingRpc("acttub_claim_coach_reply", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_run_id: input.runId,
      p_request_id: input.requestId, p_request_fingerprint: input.requestFingerprint,
      p_operation_id: input.operationId, p_actor_turn_id: input.actorTurnId,
      p_actor_text: input.actorText, p_retry_actor_turn_id: input.retryActorTurnId ?? null,
      p_lease_token: input.leaseToken, p_lease_seconds: input.leaseSeconds,
      p_expected_ai_turn_id: input.expectedAiTurnId ?? null,
    }), input);
  },

  async completeCoachTurn(input: {
    sessionId: string; userId: string; runId: string; operationId: string; leaseToken: string;
    actingSessionId: string; aiTurnId: string; question: string; action: string;
    focusTimestamp: string; done: boolean; closeReason: string; responsePayload: JsonRecord;
  }): Promise<void> {
    await callActingRpc("acttub_complete_coach_turn", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_run_id: input.runId,
      p_operation_id: input.operationId, p_lease_token: input.leaseToken,
      p_acting_session_id: input.actingSessionId, p_ai_turn_id: input.aiTurnId,
      p_question: input.question, p_action: input.action, p_focus_timestamp: input.focusTimestamp,
      p_done: input.done, p_close_reason: input.closeReason, p_response_payload: input.responsePayload,
    });
  },

  async failCoachOperation(input: {
    sessionId: string; userId: string; runId: string; operationId: string; leaseToken: string;
    actorTurnId?: string | null; failureClass: string; safeErrorCode: string;
  }): Promise<void> {
    await callActingRpc("acttub_fail_coach_operation", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_run_id: input.runId,
      p_operation_id: input.operationId, p_lease_token: input.leaseToken,
      p_actor_turn_id: input.actorTurnId ?? null, p_failure_class: input.failureClass,
      p_safe_error_code: input.safeErrorCode,
    });
  },

  async expireCoachRun(input: {
    sessionId: string; userId: string; runId: string; operationId: string;
    leaseToken: string; actorTurnId?: string | null;
  }): Promise<void> {
    await callActingRpc("acttub_expire_coach_run", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_run_id: input.runId,
      p_operation_id: input.operationId, p_lease_token: input.leaseToken,
      p_actor_turn_id: input.actorTurnId ?? null,
    });
  },

  async claimReport(input: {
    sessionId: string; userId: string; requestId: string; requestFingerprint: string;
    operationId: string; leaseToken: string; leaseSeconds: number;
  }): Promise<ActingRpcResult> {
    return await normalizeClaim(await callActingRpc("acttub_claim_report", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_request_id: input.requestId,
      p_request_fingerprint: input.requestFingerprint, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_lease_seconds: input.leaseSeconds,
    }), input);
  },

  async completeReport(input: {
    sessionId: string; userId: string; operationId: string; leaseToken: string;
    reportId: string; reportPayload: JsonRecord; reportCount: number; responsePayload: JsonRecord;
  }): Promise<void> {
    await callActingRpc("acttub_complete_report", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_report_id: input.reportId,
      p_report_payload: input.reportPayload, p_report_count: input.reportCount,
      p_response_payload: input.responsePayload,
    });
  },

  async failReport(input: {
    sessionId: string; userId: string; operationId: string; leaseToken: string;
    failureClass: string; safeErrorCode: string;
  }): Promise<void> {
    await callActingRpc("acttub_fail_report", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_operation_id: input.operationId,
      p_lease_token: input.leaseToken, p_failure_class: input.failureClass,
      p_safe_error_code: input.safeErrorCode,
    });
  },

  async sealExpiredOperation(input: {
    sessionId: string; userId: string; operationId: string;
  }): Promise<void> {
    await callActingRpc("acttub_seal_expired_operation", {
      p_session_id: input.sessionId, p_user_id: input.userId, p_operation_id: input.operationId,
    });
  },

  async expireUploadIntent(uploadIntentId: string, userId: string): Promise<void> {
    if (!configuredForSupabasePersistence()) return;

    const admin = requireSupabaseAdminClient();
    const { error } = await admin
      .from("upload_intents")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", uploadIntentId)
      .eq("user_id", userId)
      .eq("status", "created");

    assertNoPersistenceError(error, "uploadIntentId", "Could not expire Supabase upload intent");
  },

  async createSession(input: {
    uploadIntent: PracticeUploadIntentDto;
    session: LegacyInternalCoachSessionDto;
    take: TakeDto;
    observation: ObservationDto;
    firstQuestion: TurnDto;
  }): Promise<LegacyInternalCoachSessionDto> {
    if (!configuredForSupabasePersistence()) return input.session;

    const admin = requireSupabaseAdminClient();
    const { uploadIntent, session, take, observation, firstQuestion } = input;
    const { data, error } = await admin.rpc("acttub_create_session_from_upload_intent", {
      p_upload_intent_id: uploadIntent.uploadIntentId,
      p_user_id: uploadIntent.userId,
      p_session_id: session.id,
      p_take_id: take.id,
      p_observation_id: observation.id,
      p_first_question_id: firstQuestion.id,
      p_medium: session.medium,
      p_genre: session.genre,
      p_situation: session.situation,
      p_character_context: session.characterContext,
      p_subtext: session.subtext || null,
      p_duration_ms: take.durationMs,
      p_observation_text: observation.observationText,
      p_observation_confidence: observation.confidence,
      p_observation_timestamp_start_ms: observation.timestampStartMs,
      p_observation_timestamp_end_ms: observation.timestampEndMs,
      p_first_question_content: firstQuestion.content,
      p_first_question_focus: firstQuestion.questionFocus,
      p_first_question_source_observation_ids: firstQuestion.sourceObservationIds,
      p_created_at: session.createdAt,
    });

    assertNoPersistenceError(
      error,
      "sessionId",
      "Could not atomically create Supabase practice session",
    );

    const createdSessionId = asString(asRecord(Array.isArray(data) ? data[0] : data).session_id, session.id);
    const hydrated = await hydrateLegacySession(createdSessionId, uploadIntent.userId);
    if (!hydrated) {
      throw new SupabaseCoachSessionPersistenceError(
        "sessionId",
        "Could not hydrate Supabase practice session after creation.",
      );
    }

    return hydrated;
  },

  async listVisible(userId: string): Promise<LegacyInternalCoachSessionDto[]> {
    if (!configuredForSupabasePersistence()) return [];

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("practice_sessions")
      .select(legacySessionSelect)
      .eq("user_id", userId)
      .is("hidden_at", null)
      .order("created_at", { ascending: false });

    assertNoPersistenceError(error, "userId", "Could not list Supabase practice sessions");
    return asArray(data)
      .filter((row) => asString(row.pipeline_version, "legacy-gemini-v1") !== "acting-api-v1")
      .map(mapLegacyInternalSession);
  },

  async findById(sessionId: string, userId: string): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;
    return hydrateLegacySession(sessionId, userId);
  },

  async findByIdIncludingHidden(sessionId: string, userId: string): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;
    return hydrateLegacySession(sessionId, userId, true);
  },

  async getOwnedSession(userId: string, sessionId: string): Promise<CoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;
    return hydrateSession(sessionId, userId);
  },

  async listOwnedSessions(userId: string): Promise<CoachSessionDto[]> {
    if (!configuredForSupabasePersistence()) return [];
    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin.from("practice_sessions").select(legacySessionSelect)
      .eq("user_id", userId).is("hidden_at", null).order("created_at", { ascending: false });
    assertNoPersistenceError(error, "userId", "Could not list owned practice sessions");

    const rows = asArray(data);
    const actingRows = rows.filter(isActingSessionRow);
    if (actingRows.length === 0) return rows.map(mapLegacySession);

    const { data: actingData, error: actingError } = await admin
      .from("practice_sessions")
      .select(actingSessionSelect)
      .eq("user_id", userId)
      .is("hidden_at", null)
      .in("id", actingRows.map((row) => asString(row.id)));
    assertNoPersistenceError(
      actingError,
      "userId",
      "Could not list acting-api practice sessions",
    );

    const actingById = new Map(
      asArray(actingData).map((row) => [asString(row.id), row]),
    );
    return rows.map((row) => {
      if (!isActingSessionRow(row)) return mapLegacySession(row);

      const actingRow = actingById.get(asString(row.id));
      if (!actingRow) {
        throw new SupabaseCoachSessionPersistenceError(
          "sessionId",
          "Could not hydrate an acting-api practice session from the list query.",
        );
      }
      return mapActingSession(actingRow);
    });
  },

  async getOwnedVideoStorage(
    userId: string,
    sessionId: string,
  ): Promise<{ storageBucket: string; storagePath: string } | null> {
    if (!configuredForSupabasePersistence()) return null;
    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("practice_takes")
      .select("storage_bucket,storage_path")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertNoPersistenceError(error, "sessionId", "Could not read owned private video storage");
    if (!data) return null;
    const row = asRecord(data);
    return {
      storageBucket: asString(row.storage_bucket),
      storagePath: asString(row.storage_path),
    };
  },

  async getOwnedReport(userId: string, sessionId: string): Promise<ActingReportDto | null> {
    if (!configuredForSupabasePersistence()) return null;
    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("practice_reports")
      .select("payload,report_count")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    assertNoPersistenceError(error, "sessionId", "Could not read acting report");
    return data ? mapActingReport(asRecord(data)) : null;
  },

  async updateObservationState(
    sessionId: string,
    userId: string,
    observationId: string,
    confirmationState: ConfirmationState,
  ): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const status = confirmationState === "accepted" ? "questioning" : undefined;
    const timestamp = new Date().toISOString();
    const observationUpdate = await admin
      .from("observations")
      .update({
        confirmation_state: confirmationState,
        blocked_for_questioning: confirmationState !== "accepted",
      })
      .eq("id", observationId)
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    assertNoPersistenceError(
      observationUpdate.error,
      "observationId",
      "Could not persist Supabase observation confirmation",
    );
    if (!observationUpdate.data) return null;

    if (status) {
      const sessionUpdate = await admin
        .from("practice_sessions")
        .update({ status, updated_at: timestamp })
        .eq("id", sessionId)
        .eq("user_id", userId)
        .is("hidden_at", null)
        .select("id")
        .maybeSingle();
      assertNoPersistenceError(sessionUpdate.error, "sessionId", "Could not update Supabase session status");
      if (!sessionUpdate.data) return null;
    }

    return hydrateLegacySession(sessionId, userId);
  },

  async addCoachTurn(
    sessionId: string,
    userId: string,
    coachTurn: TurnDto,
  ): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("question_turns")
      .insert({
        id: coachTurn.id,
        session_id: sessionId,
        user_id: userId,
        speaker: "acttub",
        content: coachTurn.content,
        question_focus: coachTurn.questionFocus,
        source_observation_ids: coachTurn.sourceObservationIds,
        turn_state: "open",
        created_at: coachTurn.createdAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(error, "turnId", "Could not append Supabase coach turn");
    if (!data) return null;

    const sessionUpdate = await admin
      .from("practice_sessions")
      .update({ status: "questioning", updated_at: coachTurn.createdAt })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .is("hidden_at", null)
      .select("id")
      .maybeSingle();
    assertNoPersistenceError(sessionUpdate.error, "sessionId", "Could not update Supabase session status");
    if (!sessionUpdate.data) return null;

    return hydrateLegacySession(sessionId, userId);
  },

  async addTurnPair(
    sessionId: string,
    userId: string,
    actorTurn: TurnDto,
    coachTurn: TurnDto,
    expectedActorAnswerCount: number,
  ): Promise<{
    session: LegacyInternalCoachSessionDto;
    actorAnswerCount: number;
  } | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin.rpc("acttub_append_turn_pair", {
      p_session_id: sessionId,
      p_user_id: userId,
      p_expected_actor_answer_count: expectedActorAnswerCount,
      p_actor_turn_id: actorTurn.id,
      p_actor_content: actorTurn.content,
      p_actor_question_focus: actorTurn.questionFocus,
      p_coach_turn_id: coachTurn.id,
      p_coach_content: coachTurn.content,
      p_coach_question_focus: coachTurn.questionFocus,
      p_coach_source_observation_ids: coachTurn.sourceObservationIds,
      p_created_at: actorTurn.createdAt,
    });

    assertNoPersistenceError(error, "turnId", "Could not append Supabase actor/coach turn pair");
    const result = asRecord(Array.isArray(data) ? data[0] : data);
    const updatedSessionId = asString(result.session_id, sessionId);
    const actorAnswerCount = asNumber(result.actor_answer_count, Number.NaN);

    if (
      !Number.isInteger(actorAnswerCount) ||
      actorAnswerCount !== expectedActorAnswerCount + 1
    ) {
      throw new SupabaseCoachSessionPersistenceError(
        "turnId",
        "Supabase returned an invalid actor-answer count after turn append.",
      );
    }

    const session = await hydrateLegacySession(updatedSessionId, userId);
    if (!session) {
      throw new SupabaseCoachSessionPersistenceError(
        "sessionId",
        "Could not hydrate Supabase practice session after turn append.",
      );
    }

    return { session, actorAnswerCount };
  },

  async saveValidationMetrics(
    sessionId: string,
    userId: string,
    validationMetrics: ValidationMetricsDto,
  ): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const { error } = await admin
      .from("validation_events")
      .insert({
        session_id: sessionId,
        user_id: userId,
        event_type: "validation_metrics",
        payload: validationMetrics,
      })
      .select("id")
      .single();

    assertNoPersistenceError(error, "validationMetrics", "Could not save Supabase validation metrics");
    return hydrateLegacySession(sessionId, userId);
  },

  async createSummary(
    sessionId: string,
    userId: string,
    finalActorSentence: string,
    validationMetrics: ValidationMetricsDto,
    questionToRevisit: string,
  ): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin.rpc("acttub_complete_session", {
      p_session_id: sessionId,
      p_user_id: userId,
      p_final_actor_sentence: finalActorSentence,
      p_validation_metrics: validationMetrics,
      p_question_to_revisit: questionToRevisit,
    });

    assertNoPersistenceError(error, "finalActorSentence", "Could not complete Supabase practice session");
    const updatedSessionId = asString(asRecord(Array.isArray(data) ? data[0] : data).session_id, sessionId);
    return hydrateLegacySession(updatedSessionId, userId);
  },

  async updateVisibility(
    sessionId: string,
    userId: string,
    hidden: boolean,
  ): Promise<LegacyInternalCoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const hiddenAt = hidden ? new Date().toISOString() : null;
    const { data, error } = await admin
      .from("practice_sessions")
      .update({ hidden_at: hiddenAt, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    assertNoPersistenceError(error, "sessionId", "Could not update Supabase session visibility");
    if (!data) return null;
    return hydrateLegacySession(sessionId, userId, true);
  },

  async updatePublicVisibility(
    sessionId: string,
    userId: string,
    hidden: boolean,
  ): Promise<CoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const hiddenAt = hidden ? new Date().toISOString() : null;
    const { data, error } = await admin
      .from("practice_sessions")
      .update({ hidden_at: hiddenAt, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    assertNoPersistenceError(error, "sessionId", "Could not update Supabase session visibility");
    if (!data) return null;
    return hydrateSession(sessionId, userId, true);
  },
};
