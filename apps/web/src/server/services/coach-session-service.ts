import type {
  CoachSessionDto,
  ConfirmationState,
  CreateSessionRequest,
  CreateUploadIntentRequest,
  Medium,
  ObservationDto,
  PracticeUploadIntentDto,
  SessionStatus,
  SignedVideoUrlResponse,
  TakeDto,
  TurnDto,
  ValidationMetricsDto,
} from "@/lib/api/types";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mockCoachSessionRepository } from "@/server/repositories/mock-coach-session-repository";
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

const mediumValues = new Set<Medium>([
  "youtube_url",
  "upload_url",
  "text_only",
]);
const allowedUploadMimeTypes = new Set(["video/mp4", "video/quicktime"]);
const uploadIntentTtlMs = 2 * 60 * 60 * 1000;
const defaultUserId = "local-dev-actor";
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

const createId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
const createUuid = (): string => crypto.randomUUID();

const requireSupabasePersistence = async (operation: () => Promise<void>): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    if (error instanceof SupabaseCoachSessionPersistenceError) {
      throw new ApiValidationError("Request validation failed", {
        [error.field]: error.message,
      });
    }
    throw error;
  }
};

const nowIso = (): string => new Date().toISOString();

const buildMockObservationText = (input: CreateSessionRequest): string =>
  `${input.characterContext.trim()} 인물이 ${input.situation.trim()} 상황에서 말보다 먼저 멈추는 순간이 보입니다.`;

const buildCoachQuestion = (session: CoachSessionDto): string => {
  const acceptedObservation = session.observations.find(
    (observation) =>
      observation.confirmationState === "accepted" &&
      !observation.blockedForQuestioning,
  );

  if (acceptedObservation) {
    return "방금 확인한 관찰을 기준으로, 그 순간 인물이 가장 숨기고 싶은 생각은 무엇이었나요?";
  }

  if (
    session.observations.some(
      (observation) => observation.confirmationState === "unasked",
    )
  ) {
    return "이 관찰이 맞는지 먼저 확인해볼게요. 인물이 잠깐 멈춘 순간이 실제 연기 의도와 연결되어 있었나요?";
  }

  return "장면에서 아직 말로 정하지 못한 목표가 있다면, 인물은 지금 무엇을 얻고 싶었나요?";
};

const makeCoachTurn = (
  sessionId: string,
  content: string,
  sourceObservationIds: string[],
  questionFocus: TurnDto["questionFocus"],
  id = createId("turn"),
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

const isSupabaseVideoMode = (): boolean => {
  const config = getAppConfig();
  return config.supabase.isConfigured && config.video.bucket === "practice-videos";
};

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

  if (storagePath !== uploadIntent.storagePath || !storagePath.startsWith(expectedPrefix) || !allowedNames.has(fileName)) {
    throw new ApiValidationError("Request validation failed", {
      storagePath: "Must match the upload intent storage path.",
    });
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : null;

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
  const size = firstMetadataValue(object, [
    "size",
    "sizeBytes",
    "size_bytes",
  ]);

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
  if (!isSupabaseVideoMode()) return;

  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new ApiValidationError("Request validation failed", {
      storageObject: "Supabase storage verification is required before finalization.",
    });
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
  isSupabaseVideoMode()
    ? `supabase://${uploadIntent.storageBucket}/${uploadIntent.storagePath}`
    : `local-dev://${uploadIntent.storagePath}`;

const storagePathFromVideoRef = (videoRef: string): string | null => {
  const config = getAppConfig();
  const supabasePrefix = `supabase://${config.video.bucket}/`;

  if (videoRef.startsWith(supabasePrefix)) {
    return videoRef.slice(supabasePrefix.length);
  }

  if (videoRef.startsWith("local-dev://")) {
    return videoRef.slice("local-dev://".length);
  }

  return null;
};


const mirrorSupabaseSessionToMock = (session: CoachSessionDto, userId: string): CoachSessionDto => {
  const existing = mockCoachSessionRepository.findByIdIncludingHidden(session.id, userId);
  return existing
    ? mockCoachSessionRepository.update(session, userId)
    : mockCoachSessionRepository.create(session, userId);
};

const readSessionForOwner = async (sessionId: string, userId: string): Promise<CoachSessionDto | null> =>
  supabaseCoachSessionRepository.isConfigured()
    ? supabaseCoachSessionRepository.findById(sessionId, userId)
    : mockCoachSessionRepository.findById(sessionId, userId);

const readUploadIntentForOwner = async (
  uploadIntentId: string,
  userId: string,
): Promise<ReturnType<typeof mockCoachSessionRepository.findUploadIntent>> => {
  const localUploadIntent = mockCoachSessionRepository.findUploadIntent(uploadIntentId, userId);
  if (!supabaseCoachSessionRepository.isConfigured()) return localUploadIntent;

  const supabaseUploadIntent = await supabaseCoachSessionRepository.findUploadIntent(uploadIntentId, userId);
  if (localUploadIntent?.status === "finalized") return localUploadIntent;
  return supabaseUploadIntent ?? localUploadIntent;
};

const assertSessionMutable = (session: CoachSessionDto, action: string): void => {
  if (session.status === "END") {
    throw new ApiValidationError("Request validation failed", {
      session: `Completed sessions cannot ${action}.`,
    });
  }
};

export const coachSessionService = {
  async createUploadIntent(payload: unknown, userId = defaultUserId): Promise<PracticeUploadIntentDto> {
    const input = payload as Partial<CreateUploadIntentRequest>;
    const metadata = input.fileMetadata;
    const config = getAppConfig();
    const maxUploadBytes = config.video.maxUploadBytes;

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

    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxUploadBytes) {
      throw new ApiValidationError("Request validation failed", {
        "fileMetadata.sizeBytes": "Must be greater than 0 and at most 300MB.",
      });
    }

    const sessionId = createUuid();
    const uploadIntentId = createUuid();
    const extension = fileExtensionForMime(mimeType);
    const uploadIntent: PracticeUploadIntentDto = {
      uploadIntentId,
      sessionId,
      userId,
      storageBucket: config.video.bucket as PracticeUploadIntentDto["storageBucket"],
      uploadUrl: `/api/v1/practice-upload-intents/${uploadIntentId}/finalize`,
      fileMetadata: {
        fileName,
        mimeType,
        sizeBytes,
        ...(typeof metadata.durationMs === "number" && Number.isFinite(metadata.durationMs) && metadata.durationMs > 0
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

    await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.createUploadIntent(uploadIntent),
    );
    return mockCoachSessionRepository.saveUploadIntent(uploadIntent, userId);
  },

  async listSessions(userId: string): Promise<{ sessions: CoachSessionDto[] }> {
    if (supabaseCoachSessionRepository.isConfigured()) {
      return { sessions: await supabaseCoachSessionRepository.listVisible(userId) };
    }

    return { sessions: mockCoachSessionRepository.listVisible(userId) };
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

    if (uploadIntent.status !== "created") {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent is not available for finalization.",
      });
    }

    if (Date.parse(uploadIntent.expiresAt) <= Date.now()) {
      mockCoachSessionRepository.updateUploadIntent({ ...uploadIntent, status: "expired" });
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent has expired.",
      });
    }

    const input = payload as { storagePath?: unknown; durationMs?: unknown };
    const storagePath = requiredText(input.storagePath, "storagePath");
    const durationMs = typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : null;

    validateExpectedStoragePath(uploadIntent, storagePath, userId);
    await verifySupabaseStorageObject(uploadIntent);
    await requireSupabasePersistence(() =>
      supabaseCoachSessionRepository.finalizeUploadIntent(uploadIntent.intent),
    );

    if (!mockCoachSessionRepository.findUploadIntent(uploadIntentId, userId)) {
      mockCoachSessionRepository.saveUploadIntent(uploadIntent.intent, userId);
    }
    const finalizedIntent = mockCoachSessionRepository.markUploadIntentFinalized(uploadIntentId, userId);

    if (!finalizedIntent) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent was not found for the authenticated user.",
      });
    }

    return {
      videoUrl: videoRefForUploadIntent(finalizedIntent),
      storagePath,
      durationMs,
    };
  },

  async createSession(payload: unknown, userId = defaultUserId): Promise<{ session: CoachSessionDto; firstQuestion: TurnDto }> {
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
    const storagePath = typeof input.storagePath === "string" && input.storagePath.trim() ? input.storagePath.trim() : null;
    let videoUrl = typeof input.videoUrl === "string" && input.videoUrl.trim() ? input.videoUrl.trim() : storagePath;
    const metadataDuration = input.fileMetadata?.durationMs;
    let durationMs: number | null = null;

    if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs > 0) {
      durationMs = input.durationMs;
    } else if (typeof metadataDuration === "number" && Number.isFinite(metadataDuration) && metadataDuration > 0) {
      durationMs = metadataDuration;
    }
    let sessionId = typeof input.sessionId === "string" && input.sessionId.trim() ? input.sessionId.trim() : createId("session");
    let finalizedUploadIntent: ReturnType<typeof mockCoachSessionRepository.findUploadIntent> = null;

    if (!input.uploadIntentId) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload sessions must be created from a finalized upload intent.",
      });
    }

    if (input.uploadIntentId) {
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
      if (uploadIntent.status !== "finalized" || !uploadIntent.finalizedAt) {
        throw new ApiValidationError("Request validation failed", {
          uploadIntentId: "Upload intent must be finalized before session creation.",
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
      sessionId = uploadIntent.sessionId;
      videoUrl = videoRefForUploadIntent(uploadIntent);
      finalizedUploadIntent = uploadIntent;
    }

    if (!videoUrl) {
      throw new ApiValidationError("Request validation failed", {
        videoUrl: "Must be provided for an upload session.",
      });
    }

    const timestamp = nowIso();
    const takeId = createUuid();
    const observationId = createUuid();

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
      timestampEndMs: take.durationMs ?? 4500,
      observationText: buildMockObservationText({
        medium: validatedMedium,
        genre,
        situation,
        characterContext,
        subtext,
        videoUrl: videoUrl ?? undefined,
        durationMs: take.durationMs ?? undefined,
      }),
      confidence: 0.72,
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
      buildCoachQuestion(baseSession),
      [observationId],
      "observation_confirmation",
      createUuid(),
    );
    if (!finalizedUploadIntent) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload intent must be finalized before session creation.",
      });
    }

    let sessionForResponse = {
      ...baseSession,
      turns: [firstQuestion],
    };

    if (supabaseCoachSessionRepository.isConfigured()) {
      sessionForResponse = await supabaseCoachSessionRepository.createSession({
        uploadIntent: finalizedUploadIntent.intent,
        session: sessionForResponse,
        take,
        observation,
        firstQuestion,
      });
    } else {
      await requireSupabasePersistence(async () => {
        await supabaseCoachSessionRepository.createSession({
          uploadIntent: finalizedUploadIntent.intent,
          session: sessionForResponse,
          take,
          observation,
          firstQuestion,
        });
      });
    }

    const session = mockCoachSessionRepository.create(
      sessionForResponse,
      userId,
    );

    return { session, firstQuestion };
  },

  async getSession(sessionId: string, userId: string): Promise<CoachSessionDto | null> {
    return readSessionForOwner(sessionId, userId);
  },

  async softHideSession(sessionId: string, userId: string): Promise<{ session: CoachSessionDto } | null> {
    if (supabaseCoachSessionRepository.isConfigured()) {
      const session = await supabaseCoachSessionRepository.updateVisibility(sessionId, userId, true);
      return session ? { session: mirrorSupabaseSessionToMock(session, userId) } : null;
    }

    const session = mockCoachSessionRepository.softHide(sessionId, userId);
    return session ? { session } : null;
  },

  async createSignedVideoUrl(sessionId: string, userId: string): Promise<SignedVideoUrlResponse | null> {
    const config = getAppConfig();
    const session = await readSessionForOwner(sessionId, userId);

    if (!session || !session.take.videoUrl) {
      return null;
    }

    const expiresInSeconds = config.video.signedUrlExpiresInSeconds || signedUrlExpiresInSeconds;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    if (!isSupabaseVideoMode()) {
      return {
        signedUrl: `/api/v1/practice-sessions/${sessionId}/video-url/mock-playback?token=${encodeURIComponent(crypto.randomUUID())}`,
        expiresAt,
        expiresInSeconds,
      };
    }

    const storagePath = storagePathFromVideoRef(session.take.videoUrl);
    const admin = createSupabaseAdminClient();

    if (!storagePath || !admin) {
      throw new ApiValidationError("Request validation failed", {
        storageObject: "Supabase signed playback requires verified private storage.",
      });
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

    const session = supabaseCoachSessionRepository.isConfigured()
      ? await supabaseCoachSessionRepository.updateObservationState(
          sessionId,
          userId,
          observationId,
          confirmationState as ConfirmationState,
        )
      : mockCoachSessionRepository.updateObservationState(
          sessionId,
          userId,
          observationId,
          confirmationState as ConfirmationState,
        );

    if (!session) return null;

    const mirroredSession = supabaseCoachSessionRepository.isConfigured()
      ? mirrorSupabaseSessionToMock(session, userId)
      : session;
    const observation = mirroredSession.observations.find((item) => item.id === observationId);
    return observation ? { session: mirroredSession, observation } : null;
  },

  async createTurn(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): Promise<{ session: CoachSessionDto; actorTurn: TurnDto; coachTurn: TurnDto } | null> {
    const actorAnswer = requiredText((payload as { actorAnswer?: unknown }).actorAnswer, "actorAnswer");
    const session = await readSessionForOwner(sessionId, userId);

    if (!session) return null;
    assertSessionMutable(session, "create new turns");

    const actorTurn: TurnDto = {
      id: createId("turn"),
      sessionId,
      speaker: "actor",
      content: actorAnswer,
      questionFocus: "missing_context",
      sourceObservationIds: [],
      turnState: "recorded",
      createdAt: nowIso(),
    };

    const acceptedObservationIds = session.observations
      .filter((observation) => observation.confirmationState === "accepted" && !observation.blockedForQuestioning)
      .map((observation) => observation.id);

    const coachTurn = makeCoachTurn(
      sessionId,
      buildCoachQuestion(session),
      acceptedObservationIds,
      acceptedObservationIds.length > 0 ? "subtext_probe" : "missing_context",
    );
    const withCoachTurn = supabaseCoachSessionRepository.isConfigured()
      ? await supabaseCoachSessionRepository.addTurnPair(sessionId, userId, actorTurn, coachTurn)
      : (() => {
          const withActorTurn = mockCoachSessionRepository.addTurn(sessionId, userId, actorTurn);
          return withActorTurn
            ? mockCoachSessionRepository.addTurn(sessionId, userId, coachTurn)
            : null;
        })();

    const mirroredSession = withCoachTurn && supabaseCoachSessionRepository.isConfigured()
      ? mirrorSupabaseSessionToMock(withCoachTurn, userId)
      : withCoachTurn;

    return mirroredSession ? { session: mirroredSession, actorTurn, coachTurn } : null;
  },

  async getSignedVideoUrl(sessionId: string, userId: string): Promise<SignedVideoUrlResponse | null> {
    return this.createSignedVideoUrl(sessionId, userId);
  },

  async updateVisibility(sessionId: string, userId: string, payload: unknown): Promise<{ session: CoachSessionDto } | null> {
    const hidden = (payload as { hidden?: unknown }).hidden;

    if (typeof hidden !== "boolean") {
      throw new ApiValidationError("Request validation failed", {
        hidden: "Must be a boolean.",
      });
    }

    const session = await readSessionForOwner(sessionId, userId);
    if (!session) return null;

    if (supabaseCoachSessionRepository.isConfigured()) {
      const updatedSession = await supabaseCoachSessionRepository.updateVisibility(sessionId, userId, hidden);
      return updatedSession ? { session: mirrorSupabaseSessionToMock(updatedSession, userId) } : null;
    }

    return {
      session: mockCoachSessionRepository.update({ ...session, hiddenAt: hidden ? nowIso() : null }, userId),
    };
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
    const updatedSession = supabaseCoachSessionRepository.isConfigured()
      ? await supabaseCoachSessionRepository.saveValidationMetrics(sessionId, userId, validationMetrics)
      : mockCoachSessionRepository.update({ ...session, validationMetrics }, userId);

    if (!updatedSession) return null;
    return {
      session: supabaseCoachSessionRepository.isConfigured()
        ? mirrorSupabaseSessionToMock(updatedSession, userId)
        : updatedSession,
      validationMetrics,
    };
  },

  async createSummary(sessionId: string, userId: string, payload: unknown): Promise<{ session: CoachSessionDto; nextReflectionQuestion: string } | null> {
    const finalActorSentence = requiredText(
      (payload as { finalActorSentence?: unknown }).finalActorSentence,
      "finalActorSentence",
    );
    const session = await readSessionForOwner(sessionId, userId);

    if (!session) return null;
    assertSessionMutable(session, "create duplicate results");

    const validationMetrics = buildValidationMetrics((payload as { validationMetrics?: unknown }).validationMetrics, {
      ...session,
      finalActorSentence,
    });
    const updatedSession = supabaseCoachSessionRepository.isConfigured()
      ? await supabaseCoachSessionRepository.createSummary(
          sessionId,
          userId,
          finalActorSentence,
          validationMetrics,
        )
      : mockCoachSessionRepository.update(
          {
            ...session,
            status: "END",
            finalActorSentence,
            validationMetrics,
          },
          userId,
        );

    if (!updatedSession) return null;

    return {
      session: supabaseCoachSessionRepository.isConfigured()
        ? mirrorSupabaseSessionToMock(updatedSession, userId)
        : updatedSession,
      nextReflectionQuestion: "다음 연습에서 이 문장을 다시 떠올리게 할 질문은 무엇인가요?",
    };
  },
};
