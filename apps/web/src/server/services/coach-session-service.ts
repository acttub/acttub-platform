import type {
  CoachSessionDto,
  ConfirmationState,
  CreateSessionRequest,
  Medium,
  ObservationDto,
  SessionStatus,
  TakeDto,
  TurnDto,
} from "@/lib/api/types";
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

const mediumValues = new Set<Medium>(["youtube_url", "upload_url", "text_only"]);
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

const nowIso = (): string => new Date().toISOString();

const buildMockObservationText = (input: CreateSessionRequest): string =>
  `${input.characterContext.trim()} 인물이 ${input.situation.trim()} 상황에서 말보다 먼저 멈추는 순간이 보입니다.`;

const buildCoachQuestion = (session: CoachSessionDto): string => {
  const acceptedObservation = session.observations.find(
    (observation) => observation.confirmationState === "accepted" && !observation.blockedForQuestioning,
  );

  if (acceptedObservation) {
    return "방금 확인한 관찰을 기준으로, 그 순간 인물이 가장 숨기고 싶은 생각은 무엇이었나요?";
  }

  if (session.observations.some((observation) => observation.confirmationState === "unasked")) {
    return "이 관찰이 맞는지 먼저 확인해볼게요. 인물이 잠깐 멈춘 순간이 실제 연기 의도와 연결되어 있었나요?";
  }

  return "장면에서 아직 말로 정하지 못한 목표가 있다면, 인물은 지금 무엇을 얻고 싶었나요?";
};

const makeCoachTurn = (
  sessionId: string,
  content: string,
  sourceObservationIds: string[],
): TurnDto => ({
  id: createId("turn"),
  sessionId,
  speaker: "coach",
  content,
  questionFocus: sourceObservationIds.length > 0 ? "subtext_probe" : "observation_confirmation",
  sourceObservationIds,
  turnState: "generated",
  createdAt: nowIso(),
});

export const coachSessionService = {
  createSession(payload: unknown): { session: CoachSessionDto; firstQuestion: TurnDto } {
    const input = payload as Partial<CreateSessionRequest>;
    const medium = input.medium;

    if (!mediumValues.has(medium as Medium)) {
      throw new ApiValidationError("Request validation failed", {
        medium: "Must be one of youtube_url, upload_url, text_only.",
      });
    }

    const validatedMedium = medium as Medium;
    const genre = requiredText(input.genre, "genre");
    const situation = requiredText(input.situation, "situation");
    const characterContext = requiredText(input.characterContext, "characterContext");
    const subtext = optionalText(input.subtext);
    const videoUrl = typeof input.videoUrl === "string" && input.videoUrl.trim() ? input.videoUrl.trim() : null;
    const durationMs = typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? input.durationMs : null;

    if (validatedMedium !== "text_only" && !videoUrl) {
      throw new ApiValidationError("Request validation failed", {
        videoUrl: "Must be provided when medium is youtube_url or upload_url.",
      });
    }

    const timestamp = nowIso();
    const sessionId = createId("session");
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
      timestampEndMs: durationMs ?? 4500,
      observationText: buildMockObservationText({
        medium: validatedMedium,
        genre,
        situation,
        characterContext,
        subtext,
        videoUrl: videoUrl ?? undefined,
        durationMs: durationMs ?? undefined,
      }),
      confidence: 0.72,
      confirmationState: "unasked",
      blockedForQuestioning: false,
      createdAt: timestamp,
    };

    const baseSession: CoachSessionDto = {
      id: sessionId,
      status: "OBSERVE_CONFIRM" satisfies SessionStatus,
      medium: validatedMedium,
      genre,
      situation,
      characterContext,
      subtext,
      finalActorSentence: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      take,
      observations: [observation],
      turns: [],
    };

    const firstQuestion = makeCoachTurn(sessionId, buildCoachQuestion(baseSession), [observationId]);
    const session = mockCoachSessionRepository.create({
      ...baseSession,
      turns: [firstQuestion],
    });

    return { session, firstQuestion };
  },

  getSession(sessionId: string): CoachSessionDto | null {
    return mockCoachSessionRepository.findById(sessionId);
  },

  updateObservation(
    sessionId: string,
    observationId: string,
    payload: unknown,
  ): { session: CoachSessionDto; observation: ObservationDto } | null {
    const confirmationState = (payload as { confirmationState?: unknown }).confirmationState;

    if (!confirmationStateValues.has(confirmationState as ConfirmationState)) {
      throw new ApiValidationError("Request validation failed", {
        confirmationState: "Must be one of unasked, accepted, rejected, unsure.",
      });
    }

    const session = mockCoachSessionRepository.updateObservationState(
      sessionId,
      observationId,
      confirmationState as ConfirmationState,
    );

    if (!session) {
      return null;
    }

    const observation = session.observations.find((item) => item.id === observationId);
    return observation ? { session, observation } : null;
  },

  createTurn(
    sessionId: string,
    payload: unknown,
  ): { session: CoachSessionDto; actorTurn: TurnDto; coachTurn: TurnDto } | null {
    const actorAnswer = requiredText((payload as { actorAnswer?: unknown }).actorAnswer, "actorAnswer");
    const session = mockCoachSessionRepository.findById(sessionId);

    if (!session) {
      return null;
    }

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
      .filter(
        (observation) => observation.confirmationState === "accepted" && !observation.blockedForQuestioning,
      )
      .map((observation) => observation.id);

    const coachTurn = makeCoachTurn(sessionId, buildCoachQuestion(session), acceptedObservationIds);
    const withActorTurn = mockCoachSessionRepository.addTurn(sessionId, actorTurn);
    const withCoachTurn = withActorTurn
      ? mockCoachSessionRepository.addTurn(sessionId, coachTurn)
      : null;

    return withCoachTurn ? { session: withCoachTurn, actorTurn, coachTurn } : null;
  },

  createSummary(sessionId: string, payload: unknown): { session: CoachSessionDto; nextReflectionQuestion: string } | null {
    const finalActorSentence = requiredText(
      (payload as { finalActorSentence?: unknown }).finalActorSentence,
      "finalActorSentence",
    );
    const session = mockCoachSessionRepository.findById(sessionId);

    if (!session) {
      return null;
    }

    const updatedSession = mockCoachSessionRepository.update({
      ...session,
      status: "END",
      finalActorSentence,
    });

    return {
      session: updatedSession,
      nextReflectionQuestion: "다음 연습에서 이 문장을 다시 떠올리게 할 질문은 무엇인가요?",
    };
  },
};
