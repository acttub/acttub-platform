import "server-only";

import type {
  CoachSessionDto,
  ObservationDto,
  PracticeUploadIntentDto,
  TakeDto,
  TurnDto,
} from "@/lib/api/types";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export class SupabaseCoachSessionPersistenceError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseCoachSessionPersistenceError";
  }
}

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

export const supabaseCoachSessionRepository = {
  isConfigured(): boolean {
    return configuredForSupabasePersistence();
  },

  async createUploadIntent(uploadIntent: PracticeUploadIntentDto): Promise<void> {
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

  async finalizeUploadIntent(uploadIntent: PracticeUploadIntentDto): Promise<void> {
    if (!configuredForSupabasePersistence()) return;

    const admin = requireSupabaseAdminClient();
    const finalizedAt = new Date().toISOString();
    const { error } = await admin
      .from("upload_intents")
      .update({
        status: "finalized",
        finalized_at: finalizedAt,
        updated_at: finalizedAt,
      })
      .eq("id", uploadIntent.uploadIntentId)
      .eq("user_id", uploadIntent.userId)
      .eq("session_id", uploadIntent.sessionId)
      .eq("expected_storage_bucket", uploadIntent.storageBucket)
      .eq("expected_storage_path", uploadIntent.storagePath)
      .eq("status", "created")
      .select("id")
      .single();

    assertNoPersistenceError(
      error,
      "uploadIntentId",
      "Could not finalize Supabase upload intent",
    );
  },

  async createSession(input: {
    uploadIntent: PracticeUploadIntentDto;
    session: CoachSessionDto;
    take: TakeDto;
    observation: ObservationDto;
    firstQuestion: TurnDto;
  }): Promise<void> {
    if (!configuredForSupabasePersistence()) return;

    const admin = requireSupabaseAdminClient();
    const { uploadIntent, session, take, observation, firstQuestion } = input;

    const sessionInsert = await admin
      .from("practice_sessions")
      .insert({
        id: session.id,
        user_id: session.userId,
        upload_intent_id: uploadIntent.uploadIntentId,
        status: "observations_pending",
        medium: session.medium,
        genre: session.genre,
        situation: session.situation,
        character_context: session.characterContext,
        subtext: session.subtext || null,
        final_actor_sentence: session.finalActorSentence,
        hidden_at: session.hiddenAt,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(
      sessionInsert.error,
      "sessionId",
      "Could not persist Supabase practice session",
    );

    const takeInsert = await admin
      .from("practice_takes")
      .insert({
        id: take.id,
        session_id: take.sessionId,
        user_id: session.userId,
        storage_bucket: uploadIntent.storageBucket,
        storage_path: uploadIntent.storagePath,
        mime_type: uploadIntent.fileMetadata.mimeType,
        size_bytes: uploadIntent.fileMetadata.sizeBytes,
        duration_ms: take.durationMs,
        analysis_status: "mocked",
        analysis_error: take.analysisError,
        created_at: take.createdAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(
      takeInsert.error,
      "takeId",
      "Could not persist Supabase practice take",
    );

    const observationInsert = await admin
      .from("observations")
      .insert({
        id: observation.id,
        session_id: session.id,
        take_id: take.id,
        user_id: session.userId,
        timestamp_start_ms: observation.timestampStartMs,
        timestamp_end_ms: observation.timestampEndMs,
        observation_text: observation.observationText,
        confidence: observation.confidence,
        confirmation_state: observation.confirmationState,
        blocked_for_questioning: observation.blockedForQuestioning,
        source_payload: { source: "mock-analysis" },
        created_at: observation.createdAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(
      observationInsert.error,
      "observationId",
      "Could not persist Supabase initial observation",
    );

    const questionInsert = await admin
      .from("question_turns")
      .insert({
        id: firstQuestion.id,
        session_id: firstQuestion.sessionId,
        user_id: session.userId,
        speaker: "acttub",
        content: firstQuestion.content,
        question_focus: firstQuestion.questionFocus,
        source_observation_ids: firstQuestion.sourceObservationIds,
        turn_state: "open",
        created_at: firstQuestion.createdAt,
      })
      .select("id")
      .single();

    assertNoPersistenceError(
      questionInsert.error,
      "turnId",
      "Could not persist Supabase initial coach question",
    );
  },
};
