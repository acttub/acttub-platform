import "server-only";

import type {
  CoachSessionDto,
  ConfirmationState,
  Medium,
  ObservationDto,
  PracticeUploadIntentDto,
  SessionStatus,
  TakeDto,
  TurnDto,
  ValidationMetricsDto,
} from "@/lib/api/types";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyOwnerSessionScope } from "@/server/session-visibility.js";

export class SupabaseCoachSessionPersistenceError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseCoachSessionPersistenceError";
  }
}

type JsonRecord = Record<string, unknown>;

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
  error: { message?: string } | null | undefined,
  field: string,
  action: string,
): void => {
  if (!error) return;

  throw new SupabaseCoachSessionPersistenceError(
    field,
    `${action}: ${error.message ?? "Supabase persistence failed."}`,
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

const mapSession = (row: JsonRecord): CoachSessionDto => ({
  id: asString(row.id),
  userId: asString(row.user_id),
  status: mapDbStatus(row.status),
  medium: asString(row.medium, "upload_url") as Medium,
  genre: asString(row.genre),
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

const sessionSelect = `
  *,
  practice_takes(*),
  observations(*),
  question_turns(*),
  validation_events(*),
  session_results(*)
`;

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
    intent: uploadIntent,
  };
};

async function hydrateSession(sessionId: string, userId: string, includeHidden = false): Promise<CoachSessionDto | null> {
  const admin = requireSupabaseAdminClient();
  const baseQuery = admin
    .from("practice_sessions")
    .select(sessionSelect);
  const query = applyOwnerSessionScope(baseQuery, { sessionId, userId, visibility: includeHidden ? "deletion" : "public" });

  const { data, error } = await query.maybeSingle();
  assertNoPersistenceError(error, "sessionId", "Could not read Supabase practice session");
  return data ? mapSession(asRecord(data)) : null;
}

export const supabaseCoachSessionRepository = {
  isConfigured(): boolean {
    return configuredForSupabasePersistence();
  },

  async createUploadIntent(
    uploadIntent: PracticeUploadIntentDto,
    consent: {
      requiredConsentVersion: string;
      aiProcessingConsentVersion: string;
      confirmedAt: string;
    },
  ): Promise<void> {
    if (!configuredForSupabasePersistence()) return;

    const admin = requireSupabaseAdminClient();
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
        consent_version: getAppConfig().termsVersion,
        required_consent_version_snapshot: consent.requiredConsentVersion,
        ai_processing_consent_version_snapshot: consent.aiProcessingConsentVersion,
        adult_confirmed_at: consent.confirmedAt,
        all_participants_confirmed_at: consent.confirmedAt,
        expires_at: uploadIntent.expiresAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(
      error,
      "uploadIntentId",
      "Could not persist Supabase upload intent",
    );
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

  async finalizeUploadIntent(uploadIntent: PracticeUploadIntentDto, durationMs: number): Promise<void> {
    if (!configuredForSupabasePersistence()) return;

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin.rpc("acttub_finalize_ai_upload", {
      p_upload_intent_id: uploadIntent.uploadIntentId,
      p_user_id: uploadIntent.userId,
      p_duration_ms: durationMs,
      p_media_metadata_version: "iso-bmff-duration.v1",
    });

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
    session: CoachSessionDto;
    take: TakeDto;
    observation: ObservationDto;
    firstQuestion: TurnDto;
  }): Promise<CoachSessionDto> {
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
    const hydrated = await hydrateSession(createdSessionId, uploadIntent.userId);
    if (!hydrated) {
      throw new SupabaseCoachSessionPersistenceError(
        "sessionId",
        "Could not hydrate Supabase practice session after creation.",
      );
    }

    return hydrated;
  },

  async listVisible(userId: string): Promise<CoachSessionDto[]> {
    if (!configuredForSupabasePersistence()) return [];

    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("practice_sessions")
      .select(sessionSelect)
      .eq("user_id", userId)
      .is("hidden_at", null)
      .eq("deletion_status", "active")
      .order("created_at", { ascending: false });

    assertNoPersistenceError(error, "userId", "Could not list Supabase practice sessions");
    return asArray(data).map(mapSession);
  },

  async findById(sessionId: string, userId: string): Promise<CoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;
    return hydrateSession(sessionId, userId);
  },

  async findByIdIncludingHidden(sessionId: string, userId: string): Promise<CoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;
    return hydrateSession(sessionId, userId, true);
  },

  async updateObservationState(
    sessionId: string,
    userId: string,
    observationId: string,
    confirmationState: ConfirmationState,
  ): Promise<CoachSessionDto | null> {
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

    return hydrateSession(sessionId, userId);
  },

  async addCoachTurn(
    sessionId: string,
    userId: string,
    coachTurn: TurnDto,
  ): Promise<CoachSessionDto | null> {
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
      .eq("deletion_status", "active")
      .is("hidden_at", null)
      .select("id")
      .maybeSingle();
    assertNoPersistenceError(sessionUpdate.error, "sessionId", "Could not update Supabase session status");
    if (!sessionUpdate.data) return null;

    return hydrateSession(sessionId, userId);
  },

  async addTurnPair(
    sessionId: string,
    userId: string,
    actorTurn: TurnDto,
    coachTurn: TurnDto,
    expectedActorAnswerCount: number,
  ): Promise<{
    session: CoachSessionDto;
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

    const session = await hydrateSession(updatedSessionId, userId);
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
  ): Promise<CoachSessionDto | null> {
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
    return hydrateSession(sessionId, userId);
  },

  async createSummary(
    sessionId: string,
    userId: string,
    finalActorSentence: string,
    validationMetrics: ValidationMetricsDto,
    questionToRevisit: string,
  ): Promise<CoachSessionDto | null> {
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
    return hydrateSession(updatedSessionId, userId);
  },

  async updateVisibility(
    sessionId: string,
    userId: string,
    hidden: boolean,
  ): Promise<CoachSessionDto | null> {
    if (!configuredForSupabasePersistence()) return null;

    const admin = requireSupabaseAdminClient();
    const hiddenAt = hidden ? new Date().toISOString() : null;
    const mutation = admin
      .from("practice_sessions")
      .update({ hidden_at: hiddenAt, updated_at: new Date().toISOString() });
    const { data, error } = await applyOwnerSessionScope(mutation, { sessionId, userId, visibility: "deletion" })
      .eq("deletion_status", "active")
      .select("id")
      .maybeSingle();

    assertNoPersistenceError(error, "sessionId", "Could not update Supabase session visibility");
    if (!data) return null;
    return hydrateSession(sessionId, userId, true);
  },
};
