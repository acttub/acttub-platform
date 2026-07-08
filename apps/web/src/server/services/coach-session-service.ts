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
): TurnDto => ({
  id: createId("turn"),
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

  if (error || !data?.some((object) => object.name === fileName)) {
    throw new ApiValidationError("Request validation failed", {
      storageObject: "Uploaded storage object was not verified at the expected bucket/path.",
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

const assertSessionMutable = (session: CoachSessionDto, action: string): void => {
  if (session.status === "END") {
    throw new ApiValidationError("Request validation failed", {
      session: `Completed sessions cannot ${action}.`,
    });
  }
};

export const coachSessionService = {
  createUploadIntent(payload: unknown, userId = defaultUserId): PracticeUploadIntentDto {
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
      status: "created",
      finalizedAt: null,
      storagePath: `users/${userId}/practice-sessions/${sessionId}/take.${extension}`,
      constraints: {
        maxUploadBytes,
        allowedMimeTypes: Array.from(allowedUploadMimeTypes),
      },
      expiresAt: new Date(Date.now() + uploadIntentTtlMs).toISOString(),
    };

    void fileName;
    return mockCoachSessionRepository.saveUploadIntent(uploadIntent, userId);
  },

  listSessions(userId: string): { sessions: CoachSessionDto[] } {
    return { sessions: mockCoachSessionRepository.listVisible(userId) };
  },

  async finalizeUploadIntent(
    uploadIntentId: string,
    payload: unknown,
    userId: string,
  ): Promise<{ videoUrl: string; storagePath: string; durationMs: number | null }> {
    const uploadIntent = mockCoachSessionRepository.findUploadIntent(uploadIntentId, userId);
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

  createSession(payload: unknown, userId = defaultUserId): { session: CoachSessionDto; firstQuestion: TurnDto } {
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
    const durationMs = typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs > 0
      ? input.durationMs
      : typeof metadataDuration === "number" && Number.isFinite(metadataDuration) && metadataDuration > 0
        ? metadataDuration
        : null;
    let sessionId = typeof input.sessionId === "string" && input.sessionId.trim() ? input.sessionId.trim() : createId("session");

    if (!input.uploadIntentId) {
      throw new ApiValidationError("Request validation failed", {
        uploadIntentId: "Upload sessions must be created from a finalized upload intent.",
      });
    }

    if (input.uploadIntentId) {
      const uploadIntent = mockCoachSessionRepository.findUploadIntent(input.uploadIntentId, userId);
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
    }

    if (!videoUrl) {
      throw new ApiValidationError("Request validation failed", {
        videoUrl: "Must be provided for an upload session.",
      });
    }

    const timestamp = nowIso();
    const takeId = createId("take");
    const observationId = createId("observation");

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
    );
    const session = mockCoachSessionRepository.create(
      {
        ...baseSession,
        turns: [firstQuestion],
      },
      userId,
    );

    return { session, firstQuestion };
  },

  getSession(sessionId: string, userId: string): CoachSessionDto | null {
    return mockCoachSessionRepository.findById(sessionId, userId);
  },

  softHideSession(sessionId: string, userId: string): { session: CoachSessionDto } | null {
    const session = mockCoachSessionRepository.softHide(sessionId, userId);
    return session ? { session } : null;
  },

  async createSignedVideoUrl(sessionId: string, userId: string): Promise<SignedVideoUrlResponse | null> {
    const config = getAppConfig();
    const session = mockCoachSessionRepository.findById(sessionId, userId);

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

  updateObservation(
    sessionId: string,
    userId: string,
    observationId: string,
    payload: unknown,
  ): { session: CoachSessionDto; observation: ObservationDto } | null {
    const confirmationState = (payload as { confirmationState?: unknown }).confirmationState;

    if (!confirmationStateValues.has(confirmationState as ConfirmationState)) {
      throw new ApiValidationError("Request validation failed", {
        confirmationState: "Must be one of unasked, accepted, rejected, unsure.",
      });
    }

    const existingSession = mockCoachSessionRepository.findById(sessionId, userId);
    if (!existingSession) return null;
    assertSessionMutable(existingSession, "update observations");

    const session = mockCoachSessionRepository.updateObservationState(
      sessionId,
      userId,
      observationId,
      confirmationState as ConfirmationState,
    );

    if (!session) return null;

    const observation = session.observations.find((item) => item.id === observationId);
    return observation ? { session, observation } : null;
  },

  createTurn(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): { session: CoachSessionDto; actorTurn: TurnDto; coachTurn: TurnDto } | null {
    const actorAnswer = requiredText((payload as { actorAnswer?: unknown }).actorAnswer, "actorAnswer");
    const session = mockCoachSessionRepository.findById(sessionId, userId);

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
    const withActorTurn = mockCoachSessionRepository.addTurn(sessionId, userId, actorTurn);
    const withCoachTurn = withActorTurn
      ? mockCoachSessionRepository.addTurn(sessionId, userId, coachTurn)
      : null;

    return withCoachTurn ? { session: withCoachTurn, actorTurn, coachTurn } : null;
  },

  async getSignedVideoUrl(sessionId: string, userId: string): Promise<SignedVideoUrlResponse | null> {
    return this.createSignedVideoUrl(sessionId, userId);
  },

  updateVisibility(sessionId: string, userId: string, payload: unknown): { session: CoachSessionDto } | null {
    const hidden = (payload as { hidden?: unknown }).hidden;

    if (typeof hidden !== "boolean") {
      throw new ApiValidationError("Request validation failed", {
        hidden: "Must be a boolean.",
      });
    }

    const session = mockCoachSessionRepository.findById(sessionId, userId);
    if (!session) return null;

    return {
      session: mockCoachSessionRepository.update({ ...session, hiddenAt: hidden ? nowIso() : null }, userId),
    };
  },

  saveValidationMetrics(
    sessionId: string,
    userId: string,
    payload: unknown,
  ): { session: CoachSessionDto; validationMetrics: ValidationMetricsDto } | null {
    const session = mockCoachSessionRepository.findById(sessionId, userId);
    if (!session) return null;
    assertSessionMutable(session, "mutate validation metrics");

    const validationMetrics = buildValidationMetrics(payload, session);
    const updatedSession = mockCoachSessionRepository.update({ ...session, validationMetrics }, userId);

    return { session: updatedSession, validationMetrics };
  },

  createSummary(sessionId: string, userId: string, payload: unknown): { session: CoachSessionDto; nextReflectionQuestion: string } | null {
    const finalActorSentence = requiredText(
      (payload as { finalActorSentence?: unknown }).finalActorSentence,
      "finalActorSentence",
    );
    const session = mockCoachSessionRepository.findById(sessionId, userId);

    if (!session) return null;
    assertSessionMutable(session, "create duplicate results");

    const validationMetrics = buildValidationMetrics((payload as { validationMetrics?: unknown }).validationMetrics, {
      ...session,
      finalActorSentence,
    });
    const updatedSession = mockCoachSessionRepository.update(
      {
        ...session,
        status: "END",
        finalActorSentence,
        validationMetrics,
      },
      userId,
    );

    return {
      session: updatedSession,
      nextReflectionQuestion: "다음 연습에서 이 문장을 다시 떠올리게 할 질문은 무엇인가요?",
    };
  },
};
