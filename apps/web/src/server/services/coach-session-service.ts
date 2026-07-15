import type {
  ConfirmationState,
  CreateSessionRequest,
  CreateTurnResponse,
  Medium,
  ObservationDto,
  SessionStatus,
  TurnDto,
  ValidationMetricsDto,
  LegacyInternalCoachSessionDto as CoachSessionDto,
} from "@/lib/api/legacy-types";

import type {
  CoachSessionDto as PublicCoachSessionDto,
  CreateUploadIntentRequest,
  PracticeUploadIntentDto,
  SignedVideoUrlResponse,
  TakeDto,
} from "@/lib/api/types";
import { createHash } from "node:crypto";
import { getAppConfig } from "@/lib/config/env";
import {
  MAX_DIALOGUE_ANSWER_COUNT,
  evaluateDialogueCompletionPolicy,
} from "@/lib/practice/dialogue-completion-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  GeminiQuestionServiceError,
  geminiQuestionService,
} from "@/server/services/gemini-question-service";
import {
  SupabaseCoachSessionPersistenceError,
  supabaseCoachSessionRepository,
} from "@/server/repositories/supabase-coach-session-repository";

export class ApiValidationError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

export class ApiConfigurationError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

export class ApiConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiConflictError";
  }
}

export class ApiUpstreamError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiUpstreamError";
  }
}

const mediumValues = new Set<Medium>([
  "youtube_url",
  "upload_url",
  "text_only",
]);
const allowedUploadMimeTypes = new Set(["video/mp4", "video/quicktime"]);
const uploadIntentTtlMs = 2 * 60 * 60 * 1000;
const signedUrlExpiresInSeconds = 10 * 60;
const confirmationStateValues = new Set<ConfirmationState>([
  "unasked",
  "accepted",
  "rejected",
  "unsure",
]);

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiValidationError("Request validation failed", {
      [field]: "Must be a non-empty string.",
    });
  }

  return value.trim();
};

const optionalText = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const createUuid = (): string => crypto.randomUUID();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const nowIso = (): string => new Date().toISOString();

const requireSupabaseConfigured = (): void => {
  if (!supabaseCoachSessionRepository.isConfigured()) {
    throw new ApiConfigurationError(
      "Supabase persistence is required. Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, and the practice-videos bucket.",
      { persistence: "Supabase is not fully configured." },
    );
  }
};

const requireSupabasePersistence = async <T>(operation: () => Promise<T>): Promise<T> => {
  requireSupabaseConfigured();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof SupabaseCoachSessionPersistenceError) {
      if (error.field === "persistence") {
        throw new ApiConfigurationError(error.message, {
          [error.field]: error.message,
        });
      }

      throw new ApiValidationError("Request validation failed", {
        [error.field]: error.message,
      });
    }
    throw error;
  }
};

const requireGeminiQuestion = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GeminiQuestionServiceError) {
      if (error.message.includes("API key")) {
        throw new ApiConfigurationError(error.message, {
          gemini: error.message,
        });
      }

      throw new ApiUpstreamError("Gemini question generation failed.", {
        gemini: error.message,
      });
    }

    throw error;
  }
};

const makeCoachTurn = (
  sessionId: string,
  content: string,
  sourceObservationIds: string[],
  questionFocus: TurnDto["questionFocus"],
  id = createUuid(),
): TurnDto => ({
  id,
  sessionId,
  speaker: "coach",
  content,
  questionFocus,
  sourceObservationIds,
  turnState: "generated",
  createdAt: nowIso(),
});

const buildValidationMetrics = (
  value: unknown,
  session?: CoachSessionDto,
): ValidationMetricsDto => {
  if (value === undefined || value === null) {
    return {
      feltHelpedFindGap1To7: null,
      feltJudged1To7: null,
      rejectionSafety1To7: null,
      answerability1To7: null,
      reuseIntent1To7: null,
      rejectedObservationReuseCount:
        session?.observations.filter(
          (observation) => observation.confirmationState === "rejected",
        ).length ?? 0,
      forbiddenLanguageCount: 0,
      finalSentenceResult: session?.finalActorSentence ? "saved" : "empty",
    };
  }

  if (typeof value !== "object") {
    throw new ApiValidationError("Request validation failed", {
      validationMetrics: "Must be an object when provided.",
    });
  }

  const input = value as Record<string, unknown>;
  const metrics: ValidationMetricsDto = {
    feltHelpedFindGap1To7: null,
    feltJudged1To7: null,
    rejectionSafety1To7: null,
    answerability1To7: null,
    reuseIntent1To7: null,
    rejectedObservationReuseCount:
      session?.observations.filter(
        (observation) => observation.confirmationState === "rejected",
      ).length ?? 0,
    forbiddenLanguageCount: 0,
    finalSentenceResult: session?.finalActorSentence ? "saved" : "empty",
  };
  const numberFields = [
    "feltHelpedFindGap1To7",
    "feltJudged1To7",
    "rejectionSafety1To7",
    "answerability1To7",
    "reuseIntent1To7",
    "rejectedObservationReuseCount",
    "forbiddenLanguageCount",
  ] as const;

  for (const field of numberFields) {
    const metricValue = input[field];
    if (metricValue === undefined) continue;
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue)) {
      throw new ApiValidationError("Request validation failed", {
        [`validationMetrics.${field}`]: "Must be a finite number.",
      });
    }
    metrics[field] = metricValue;
  }

  if (input.finalSentenceResult !== undefined) {
    if (
      input.finalSentenceResult !== "saved" &&
      input.finalSentenceResult !== "empty"
    ) {
      throw new ApiValidationError("Request validation failed", {
        "validationMetrics.finalSentenceResult": "Must be saved or empty.",
      });
    }
    metrics.finalSentenceResult = input.finalSentenceResult;
  }

  return metrics;
};

const fileExtensionForMime = (mimeType: string): "mp4" | "mov" =>
  mimeType === "video/quicktime" ? "mov" : "mp4";

const validateExpectedStoragePath = (
  uploadIntent: PracticeUploadIntentDto,
  storagePath: string,
  userId: string,
): void => {
  const expectedPrefix = `users/${userId}/practice-sessions/${uploadIntent.sessionId}/`;
  const allowedNames = new Set(["take.mp4", "take.mov"]);
  const fileName = storagePath.split("/").pop() ?? "";

  if (uploadIntent.storageBucket !== getAppConfig().video.bucket) {
    throw new ApiValidationError("Request validation failed", {
      storageBucket: "Upload intent bucket must match the configured video bucket.",
    });
  }

  if (
    storagePath !== uploadIntent.storagePath ||
    !storagePath.startsWith(expectedPrefix) ||
    !allowedNames.has(fileName)
  ) {
    throw new ApiValidationError("Request validation failed", {
      storagePath: "Must match the upload intent storage path.",
    });
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const firstMetadataValue = (
  object: Record<string, unknown>,
  keys: string[],
): unknown => {
  const metadata = asRecord(object.metadata);

  for (const key of keys) {
    if (metadata?.[key] !== undefined) return metadata[key];
    if (object[key] !== undefined) return object[key];
  }

  return undefined;
};

const storageObjectMimeType = (object: Record<string, unknown>): string | null => {
  const mimeType = firstMetadataValue(object, [
    "mimetype",
    "mimeType",
    "contentType",
    "content_type",
    "mime_type",
  ]);

  return typeof mimeType === "string" && mimeType.trim().length > 0
    ? mimeType.trim()
    : null;
};

const storageObjectSizeBytes = (object: Record<string, unknown>): number | null => {
  const size = firstMetadataValue(object, ["size", "sizeBytes", "size_bytes"]);

  if (typeof size === "number" && Number.isFinite(size)) return size;

  if (typeof size === "string" && size.trim().length > 0) {
    const parsedSize = Number(size);
    return Number.isFinite(parsedSize) ? parsedSize : null;
  }

  return null;
};

const verifySupabaseStorageObject = async (
  uploadIntent: PracticeUploadIntentDto,
): Promise<void> => {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new ApiConfigurationError(
      "Supabase storage verification requires SUPABASE_SERVICE_ROLE_KEY.",
      { storageObject: "Supabase storage verification is required before session creation." },
    );
  }

  const pathParts = uploadIntent.storagePath.split("/");
  const fileName = pathParts.pop();
  const directory = pathParts.join("/");

  if (!fileName || !directory) {
    throw new ApiValidationError("Request validation failed", {
      storagePath: "Must be a complete storage object path.",
    });
  }

  const { data, error } = await admin.storage
    .from(uploadIntent.storageBucket)
    .list(directory, { limit: 100, search: fileName });

  const storageObject = data
    ?.map((object) => asRecord(object))
    .find((object) => object?.name === fileName);

  if (error || !storageObject) {
    throw new ApiValidationError("Request validation failed", {
      storageObject: "Uploaded storage object was not verified at the expected bucket/path.",
    });
  }

  const actualMimeType = storageObjectMimeType(storageObject);
  const actualSizeBytes = storageObjectSizeBytes(storageObject);

  if (
    actualMimeType !== uploadIntent.fileMetadata.mimeType ||
    actualSizeBytes !== uploadIntent.fileMetadata.sizeBytes
  ) {
    throw new ApiValidationError("Request validation failed", {
      storageObject: "Uploaded storage object metadata does not match the upload intent.",
    });
  }
};

const videoRefForUploadIntent = (uploadIntent: PracticeUploadIntentDto): string =>
  `supabase://${uploadIntent.storageBucket}/${uploadIntent.storagePath}`;

const readSessionForOwner = async (
  sessionId: string,
  userId: string,
): Promise<CoachSessionDto | null> =>
  requireSupabasePersistence(() =>
    supabaseCoachSessionRepository.findById(sessionId, userId),
  );

const readUploadIntentForOwner = async (
  uploadIntentId: string,
  userId: string,
) =>
  requireSupabasePersistence(() =>
    supabaseCoachSessionRepository.findUploadIntent(uploadIntentId, userId),
  );

const assertSessionMutable = (session: CoachSessionDto, action: string): void => {
  if (session.status === "END") {
    throw new ApiValidationError("Request validation failed", {
      session: `Completed sessions cannot ${action}.`,
    });
  }
};

const acceptedSourceObservationIds = (session: CoachSessionDto): string[] =>
  session.observations
    .filter(
      (observation) =>
        observation.confirmationState === "accepted" &&
        !observation.blockedForQuestioning,
    )
    .map((observation) => observation.id);

export const coachSessionService = {
  async createUploadIntent(
    payload: unknown,
    userId: string,
  ): Promise<PracticeUploadIntentDto> {
    requireSupabaseConfigured();

    const input = payload as Partial<CreateUploadIntentRequest>;
    const metadata = input.fileMetadata;
    const config = getAppConfig();
    const maxUploadBytes = config.video.maxUploadBytes;

    if (config.video.bucket !== "practice-videos") {
      throw new ApiConfigurationError(
        "The practice-videos Supabase bucket is required for upload persistence.",
        { storageBucket: "NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET must be practice-videos." },
      );
    }

    if (!metadata || typeof metadata !== "object") {
      throw new ApiValidationError("Request validation failed", {
        fileMetadata: "Must be provided.",
      });
    }

    const fileName = requiredText(metadata.fileName, "fileMetadata.fileName");
    const mimeType = metadata.mimeType;
    const sizeBytes = metadata.sizeBytes;

    if (!allowedUploadMimeTypes.has(mimeType)) {
      throw new ApiValidationError("Request validation failed", {
        "fileMetadata.mimeType": "Must be video/mp4 or video/quicktime.",
      });
    }

    if (
      typeof sizeBytes !== "number" ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > maxUploadBytes
    ) {
      throw new ApiValidationError("Request validation failed", {
        "fileMetadata.sizeBytes": "Must be greater than 0 and at most 550MB.",
      });
    }

    const requestId = input.requestId;
    if (requestId !== undefined && (typeof requestId !== "string" || !uuidPattern.test(requestId))) {
      throw new ApiValidationError("Request validation failed", {
        requestId: "Must be a UUID when provided.",
      });
    }

    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify([fileName, mimeType, sizeBytes]))
      .digest("hex");
    const sessionId = createUuid();
    const uploadIntentId = createUuid();
    const extension = fileExtensionForMime(mimeType);
    const uploadIntent: PracticeUploadIntentDto = {
      uploadIntentId,
      sessionId,
      userId,
      storageBucket: "practice-videos",
      uploadUrl: `/api/v1/practice-upload-intents/${uploadIntentId}/finalize`,
      fileMetadata: {
        fileName,
        mimeType,
        sizeBytes,
        ...(typeof metadata.durationMs === "number" &&
        Number.isFinite(metadata.durationMs) &&
        metadata.durationMs > 0
          ? { durationMs: metadata.durationMs }
          : {}),
      },
      status: "created",
      finalizedAt: null,
      storagePath: `users/${userId}/practice-sessions/${sessionId}/take.${extension}`,
      constraints: {
        maxUploadBytes,
        allowedMimeTypes: Array.from(allowedUploadMimeTypes),
      },
      expiresAt: new Date(Date.now() + uploadIntentTtlMs).toISOString(),
    };

    try {
      return await requireSupabasePersistence(() =>
        supabaseCoachSessionRepository.createUploadIntent(uploadIntent, requestId
          ? { requestId, requestFingerprint }
          : undefined),
      );
    } catch (error) {
      if (
        error instanceof SupabaseCoachSessionPersistenceError &&
        error.message.includes("request_id_conflict")
      ) {
        throw new ApiConflictError("request_id_conflict", "requestId was already used.");
      }
      throw error;
    }
  },

  async listSessions(userId: string): Promise<{ sessions: PublicCoachSessionDto[] }> {
    return {
      sessions: await requireSupabasePersistence(() =>
        supabaseCoachSessionRepository.listOwnedSessions(userId),
      ),
    };
  },

  async finalizeUploadIntent(
    uploadIntentId: string,
    payload: unknown,
    userId: string,
  ): Promise<{ videoUrl: string; storagePath: string; durationMs: number | null }> {
    const uploadIntent = await readUploadIntentForOwner(uploadIntentId, userId);
    if (!uploadIntent) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent was not found for the authenticated user.",
      });
    }

    const input = payload as { storagePath?: unknown; durationMs?: unknown };
    const storagePath = requiredText(input.storagePath, "storagePath");
    if (
      typeof input.durationMs !== "number" ||
      !Number.isInteger(input.durationMs) ||
      input.durationMs < 1 ||
      input.durationMs > 180_000
    ) {
      throw new ApiValidationError("Request validation failed", {
        durationMs: "Must be an integer from 1 to 180000.",
      });
    }
    const reportedDurationMs = input.durationMs;

    validateExpectedStoragePath(uploadIntent.intent, storagePath, userId);

    if (["validating", "finalized"].includes(uploadIntent.status)) {
      if ((uploadIntent.reportedDurationMs ?? uploadIntent.finalizedDurationMs) !== reportedDurationMs) {
        throw new ApiValidationError("Request validation failed", {
          durationMs: "Must match the duration already stored for this upload intent.",
        });
      }
      return {
        videoUrl: videoRefForUploadIntent(uploadIntent.intent),
        storagePath,
        durationMs: reportedDurationMs,
      };
    }

    if (uploadIntent.status !== "created") {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent is not available for verification.",
      });
    }

    if (Date.parse(uploadIntent.expiresAt) <= Date.now()) {
      await requireSupabasePersistence(() =>
        supabaseCoachSessionRepository.expireUploadIntent(uploadIntentId, userId),
      );
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent has expired.",
      });
    }

    await verifySupabaseStorageObject(uploadIntent.intent);
    await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.finalizeUploadIntent(uploadIntent.intent),
    );

    return {
      videoUrl: videoRefForUploadIntent(uploadIntent.intent),
      storagePath,
      durationMs: reportedDurationMs,
    };
  },

  async createSession(
    payload: unknown,
    userId: string,
  ): Promise<{ session: CoachSessionDto; firstQuestion: TurnDto }> {
    const input = payload as Partial<CreateSessionRequest>;
    const medium = input.medium;

    if (!mediumValues.has(medium as Medium)) {
      throw new ApiValidationError("Request validation failed", {
        medium: "Must be one of youtube_url, upload_url, text_only.",
      });
    }

    const validatedMedium = medium as Medium;

    if (validatedMedium !== "upload_url") {
      throw new ApiValidationError("Request validation failed", {
        medium: "Slice 1 requires medium to be upload_url.",
      });
    }

    const genre = requiredText(input.genre, "genre");
    const situation = requiredText(input.situation, "situation");
    const characterContext = requiredText(input.characterContext, "characterContext");
    const subtext = optionalText(input.subtext);
    const storagePath =
      typeof input.storagePath === "string" && input.storagePath.trim()
        ? input.storagePath.trim()
        : null;
    const metadataDuration = input.fileMetadata?.durationMs;
    let durationMs: number | null = null;

    if (
      typeof input.durationMs === "number" &&
      Number.isFinite(input.durationMs) &&
      input.durationMs > 0
    ) {
      durationMs = input.durationMs;
    } else if (
      typeof metadataDuration === "number" &&
      Number.isFinite(metadataDuration) &&
      metadataDuration > 0
    ) {
      durationMs = metadataDuration;
    }

    if (!input.uploadIntentId) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload sessions must be created from a verified Supabase upload intent.",
      });
    }

    const uploadIntent = await readUploadIntentForOwner(input.uploadIntentId, userId);
    if (!uploadIntent) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent was not found for the current user.",
      });
    }
    if (Date.parse(uploadIntent.expiresAt) <= Date.now()) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent has expired.",
      });
    }
    if (uploadIntent.status !== "created") {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent is not available for session creation.",
      });
    }
    if (input.sessionId && input.sessionId !== uploadIntent.sessionId) {
      throw new ApiValidationError("Request validation failed", {
        sessionId: "Must match the upload intent sessionId.",
      });
    }
    if (storagePath && storagePath !== uploadIntent.storagePath) {
      throw new ApiValidationError("Request validation failed", {
        storagePath: "Must match the upload intent storage path.",
      });
    }

    await verifySupabaseStorageObject(uploadIntent.intent);

    const sessionId = uploadIntent.sessionId;
    const videoUrl = videoRefForUploadIntent(uploadIntent.intent);
    const timestamp = nowIso();
    const takeId = createUuid();
    const observationId = createUuid();
    const initialQuestion = await requireGeminiQuestion(() =>
      geminiQuestionService.createInitialQuestion({
        medium: validatedMedium,
        genre,
        situation,
        characterContext,
        subtext,
        videoUrl,
        durationMs: durationMs ?? undefined,
        sessionId,
        uploadIntentId: uploadIntent.uploadIntentId,
        storagePath: uploadIntent.storagePath,
        fileMetadata: uploadIntent.fileMetadata,
      }),
    );

    const take: TakeDto = {
      id: takeId,
      sessionId,
      videoUrl,
      durationMs,
      analysisStatus: "completed",
      analysisError: null,
      createdAt: timestamp,
    };

    const observation: ObservationDto = {
      id: observationId,
      takeId,
      timestampStartMs: 0,
      timestampEndMs: take.durationMs ?? 0,
      observationText: initialQuestion.observationText,
      confidence: initialQuestion.confidence,
      confirmationState: "unasked",
      blockedForQuestioning: false,
      createdAt: timestamp,
    };

    const baseSession: CoachSessionDto = {
      id: sessionId,
      userId,
      status: "OBSERVE_CONFIRM" satisfies SessionStatus,
      medium: validatedMedium,
      genre,
      situation,
      characterContext,
      subtext,
      finalActorSentence: null,
      hiddenAt: null,
      validationMetrics: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      take,
      observations: [observation],
      turns: [],
    };

    const firstQuestion = makeCoachTurn(
      sessionId,
      initialQuestion.question,
      initialQuestion.questionFocus === "observation_confirmation" ? [observationId] : [],
      initialQuestion.questionFocus,
      createUuid(),
    );

    const sessionForResponse = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.createSession({
        uploadIntent: uploadIntent.intent,
        session: {
          ...baseSession,
          turns: [firstQuestion],
        },
        take,
        observation,
        firstQuestion,
      }),
    );

    return {
      session: sessionForResponse,
      firstQuestion:
        sessionForResponse.turns.find((turn) => turn.id === firstQuestion.id) ??
        firstQuestion,
    };
  },

  async getSession(sessionId: string, userId: string): Promise<PublicCoachSessionDto | null> {
    return requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.getOwnedSession(userId, sessionId),
    );
  },

  async softHideSession(
    sessionId: string,
    userId: string,
  ): Promise<{ session: PublicCoachSessionDto } | null> {
    const session = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.updatePublicVisibility(sessionId, userId, true),
    );
    return session ? { session } : null;
  },

  async createSignedVideoUrl(
    sessionId: string,
    userId: string,
  ): Promise<SignedVideoUrlResponse | null> {
    requireSupabaseConfigured();

    const config = getAppConfig();
    const session = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.getOwnedSession(userId, sessionId),
    );

    if (!session) {
      return null;
    }

    const storageObject = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.getOwnedVideoStorage(userId, sessionId),
    );

    if (!storageObject) {
      return null;
    }

    if (storageObject.storageBucket !== config.video.bucket) {
      throw new ApiValidationError("Request validation failed", {
        storageObject: "Unexpected private video storage bucket.",
      });
    }

    const expiresInSeconds =
      config.video.signedUrlExpiresInSeconds || signedUrlExpiresInSeconds;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const storagePath = storageObject.storagePath;
    const admin = createSupabaseAdminClient();

    if (!admin) {
      throw new ApiConfigurationError(
        "Supabase signed playback requires verified private storage.",
        { storageObject: "Could not create a signed video URL without Supabase admin access." },
      );
    }

    const { data, error } = await admin.storage
      .from(config.video.bucket)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new ApiValidationError("Request validation failed", {
        storageObject: "Could not create a private signed video URL.",
      });
    }

    return {
      signedUrl: data.signedUrl,
      expiresAt,
      expiresInSeconds,
    };
  },

  async updateObservation(
    sessionId: string,
    userId: string,
    observationId: string,
    payload: unknown,
  ): Promise<{ session: CoachSessionDto; observation: ObservationDto } | null> {
    const confirmationState = (payload as { confirmationState?: unknown }).confirmationState;

    if (!confirmationStateValues.has(confirmationState as ConfirmationState)) {
      throw new ApiValidationError("Request validation failed", {
        confirmationState: "Must be one of unasked, accepted, rejected, unsure.",
      });
    }

    const existingSession = await readSessionForOwner(sessionId, userId);
    if (!existingSession) return null;
    assertSessionMutable(existingSession, "update observations");

    const updatedSession = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.updateObservationState(
        sessionId,
        userId,
        observationId,
        confirmationState as ConfirmationState,
      ),
    );

    if (!updatedSession) return null;

    const observation = updatedSession.observations.find((item) => item.id === observationId);
    if (!observation) return null;

    const generatedQuestion = await requireGeminiQuestion(() =>
      geminiQuestionService.createObservationFollowUp(
        updatedSession,
        confirmationState as ConfirmationState,
      ),
    );
    const sourceObservationIds =
      generatedQuestion.questionFocus === "subtext_probe"
        ? acceptedSourceObservationIds(updatedSession)
        : [];
    const coachTurn = makeCoachTurn(
      sessionId,
      generatedQuestion.question,
      sourceObservationIds,
      generatedQuestion.questionFocus,
      createUuid(),
    );
    const sessionWithTurn = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.addCoachTurn(sessionId, userId, coachTurn),
    );

    if (!sessionWithTurn) return null;

    const persistedObservation = sessionWithTurn.observations.find(
      (item) => item.id === observationId,
    );
    return persistedObservation
      ? { session: sessionWithTurn, observation: persistedObservation }
      : null;
  },

  async createTurn(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): Promise<CreateTurnResponse | null> {
    const actorAnswer = requiredText(
      (payload as { actorAnswer?: unknown }).actorAnswer,
      "actorAnswer",
    );
    const session = await readSessionForOwner(sessionId, userId);

    if (!session) return null;
    assertSessionMutable(session, "create new turns");

    const existingAnswerCount = session.turns.filter(
      (turn) => turn.speaker === "actor",
    ).length;
    const latestCoachTurn = session.turns
      .filter((turn) => turn.speaker === "coach")
      .at(-1);

    if (latestCoachTurn?.questionFocus === "summary_reflection") {
      throw new ApiValidationError("Request validation failed", {
        dialogue: "Dialogue already ended with a summary reflection.",
      });
    }

    if (existingAnswerCount >= MAX_DIALOGUE_ANSWER_COUNT) {
      throw new ApiValidationError("Request validation failed", {
        actorAnswer: `Dialogue cannot exceed ${MAX_DIALOGUE_ANSWER_COUNT} actor answers.`,
      });
    }

    const answerCount = existingAnswerCount + 1;

    const timestamp = nowIso();
    const actorTurn: TurnDto = {
      id: createUuid(),
      sessionId,
      speaker: "actor",
      content: actorAnswer,
      questionFocus: "missing_context",
      sourceObservationIds: [],
      turnState: "recorded",
      createdAt: timestamp,
    };

    const generatedQuestion = await requireGeminiQuestion(() =>
      geminiQuestionService.createNextQuestion(session, actorAnswer),
    );
    const completion = evaluateDialogueCompletionPolicy(
      answerCount,
      generatedQuestion.dialogueSufficient,
    );

    if (
      completion.dialogueComplete !== generatedQuestion.dialogueSufficient ||
      (generatedQuestion.questionFocus === "summary_reflection") !==
        completion.dialogueComplete
    ) {
      throw new ApiUpstreamError(
        "Gemini dialogue decision did not match the bounded dialogue policy.",
        {
          gemini: "Dialogue sufficiency, question focus, and service completion must agree.",
        },
      );
    }

    const questionFocus = generatedQuestion.questionFocus;
    const sourceObservationIds =
      questionFocus === "subtext_probe"
        ? acceptedSourceObservationIds(session)
        : [];
    const coachTurn = makeCoachTurn(
      sessionId,
      generatedQuestion.question,
      sourceObservationIds,
      questionFocus,
      createUuid(),
    );
    coachTurn.createdAt = timestamp;

    const persistedTurnPair = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.addTurnPair(
        sessionId,
        userId,
        actorTurn,
        coachTurn,
        existingAnswerCount,
      ),
    );

    return persistedTurnPair
      ? {
          session: persistedTurnPair.session,
          actorTurn,
          coachTurn,
          dialogueComplete: completion.dialogueComplete,
          answerCount: persistedTurnPair.actorAnswerCount,
          completionReason: completion.completionReason,
        }
      : null;
  },

  async getSignedVideoUrl(
    sessionId: string,
    userId: string,
  ): Promise<SignedVideoUrlResponse | null> {
    return this.createSignedVideoUrl(sessionId, userId);
  },

  async updateVisibility(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): Promise<{ session: CoachSessionDto } | null> {
    const hidden = (payload as { hidden?: unknown }).hidden;

    if (typeof hidden !== "boolean") {
      throw new ApiValidationError("Request validation failed", {
        hidden: "Must be a boolean.",
      });
    }

    const session = await readSessionForOwner(sessionId, userId);
    if (!session) return null;

    const updatedSession = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.updateVisibility(sessionId, userId, hidden),
    );
    return updatedSession ? { session: updatedSession } : null;
  },

  async saveValidationMetrics(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): Promise<{ session: CoachSessionDto; validationMetrics: ValidationMetricsDto } | null> {
    const session = await readSessionForOwner(sessionId, userId);
    if (!session) return null;
    assertSessionMutable(session, "mutate validation metrics");

    const validationMetrics = buildValidationMetrics(payload, session);
    const updatedSession = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.saveValidationMetrics(
        sessionId,
        userId,
        validationMetrics,
      ),
    );

    if (!updatedSession) return null;
    return {
      session: updatedSession,
      validationMetrics,
    };
  },

  async createSummary(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): Promise<{ session: CoachSessionDto; nextReflectionQuestion: string } | null> {
    const finalActorSentence = requiredText(
      (payload as { finalActorSentence?: unknown }).finalActorSentence,
      "finalActorSentence",
    );
    const session = await readSessionForOwner(sessionId, userId);

    if (!session) return null;
    assertSessionMutable(session, "create duplicate results");

    const nextReflectionQuestion = await requireGeminiQuestion(() =>
      geminiQuestionService.createQuestionToRevisit(session, finalActorSentence),
    );
    const validationMetrics = buildValidationMetrics(
      (payload as { validationMetrics?: unknown }).validationMetrics,
      {
        ...session,
        finalActorSentence,
      },
    );
    const updatedSession = await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.createSummary(
        sessionId,
        userId,
        finalActorSentence,
        validationMetrics,
        nextReflectionQuestion,
      ),
    );

    if (!updatedSession) return null;

    return {
      session: updatedSession,
      nextReflectionQuestion,
    };
  },
};
