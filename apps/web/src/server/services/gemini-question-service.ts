import "server-only";

import type {
  CoachSessionDto,
  CreateSessionRequest,
  ObservationDto,
  TurnDto,
} from "@/lib/api/types";
import {
  MAX_DIALOGUE_ANSWER_COUNT,
  MIN_DIALOGUE_ANSWER_COUNT,
  matchesRequiredDialogueSufficiency,
  requiredDialogueSufficiencyForAnswerCount,
} from "@/lib/practice/dialogue-completion-policy";

const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const MAX_RECENT_DIALOGUE_TURNS = MAX_DIALOGUE_ANSWER_COUNT * 2 + 2;

const bannedQuestionLanguage = [
  new RegExp(
    [
      "sco" + "re",
      "gra" + "de",
      "rank",
      "rating",
      "diagnos",
      "weak" + "ness",
      "improve" + "ment",
    ].join("|"),
    "i",
  ),
  new RegExp(
    [
      "점" + "수",
      "채" + "점",
      "등" + "급",
      "랭킹",
      "평" + "가",
      "평" + "가표",
      "약" + "점",
      "개" + "선점",
      "진" + "단",
      "피드" + "백 카드",
    ].join("|"),
  ),
];

type GeminiQuestionFocus = TurnDto["questionFocus"];

type GeminiInteractionResponse = {
  output_text?: unknown;
  steps?: unknown;
  error?: {
    message?: string;
  };
};

type InitialQuestionResult = {
  observationText: string;
  confidence: number;
  question: string;
  questionFocus: Extract<GeminiQuestionFocus, "observation_confirmation" | "missing_context">;
};

type GeneratedQuestionResult = {
  question: string;
  questionFocus: GeminiQuestionFocus;
};

type NextQuestionResult = GeneratedQuestionResult & {
  dialogueSufficient: boolean;
};

export class GeminiQuestionServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiQuestionServiceError";
  }
}

function getGeminiApiKey(): string {
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";

  if (!apiKey.trim()) {
    throw new GeminiQuestionServiceError(
      "Gemini API key is required. Set GEMINI_API_KEY on the server.",
    );
  }

  return apiKey.trim();
}

export function getGeminiQuestionModel(): string {
  return (
    process.env.GEMINI_QUESTION_MODEL ??
    process.env.GEMINI_MODEL ??
    DEFAULT_GEMINI_MODEL
  ).trim();
}

function systemInstruction(): string {
  return [
    "너는 Acttub의 질문 파트너다.",
    "배우를 판단하거나 수치화하지 말고, 사용자가 자기 말로 장면의 생각을 발견하게 돕는다.",
    "반드시 한국어로 답한다.",
    "출력은 JSON 하나만 반환한다. 마크다운, 코드블록, 설명 문장을 붙이지 않는다.",
    "질문은 한 번에 하나만 생성하고 물음표는 하나만 쓴다.",
    "영상 내용을 직접 봤다고 주장하지 않는다. 제공된 장면 맥락, 확인된 관찰, 사용자의 답변, 부족한 맥락만 근거로 삼는다.",
    "거절되었거나 blocked_for_questioning=true인 관찰은 근거로 쓰지 않는다.",
    "개인 심리치료, 트라우마, 의학적 조언으로 들어가지 않는다.",
  ].join("\n");
}

function safeJsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const textParts = content
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item !== "object" || item === null) return "";
      const record = item as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean);

  return textParts.length > 0 ? textParts.join("\n") : null;
}

function extractGeminiText(payload: GeminiInteractionResponse): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (const step of [...steps].reverse()) {
    if (typeof step !== "object" || step === null) continue;
    const text = extractTextFromContent((step as Record<string, unknown>).content);
    if (text?.trim()) return text.trim();
  }

  throw new GeminiQuestionServiceError("Gemini response did not contain text output.");
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const raw = stripJsonFence(text);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }

  throw new GeminiQuestionServiceError("Gemini response was not a JSON object.");
}

function getRequiredText(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new GeminiQuestionServiceError(`Gemini response missing ${field}.`);
  }

  return value.trim();
}

function getRequiredBoolean(
  payload: Record<string, unknown>,
  field: string,
): boolean {
  const value = payload[field];
  if (typeof value !== "boolean") {
    throw new GeminiQuestionServiceError(
      `Gemini response field ${field} must be a boolean.`,
    );
  }

  return value;
}

function getConfidence(payload: Record<string, unknown>): number {
  const value = payload.confidence;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  return 0.5;
}

function ensureSafeSingleQuestion(question: string): string {
  let trimmed = question.replace(/\s+/g, " ").trim();
  const questionMarkCount = [...trimmed].filter((char) => char === "?" || char === "？").length;

  if (questionMarkCount === 0) {
    trimmed = `${trimmed.replace(/[.!。？?]+$/u, "")}?`;
  }

  if (trimmed.length < 8 || trimmed.length > 220) {
    throw new GeminiQuestionServiceError("Gemini question length is outside the allowed range.");
  }

  if (questionMarkCount > 1) {
    throw new GeminiQuestionServiceError("Gemini must return exactly one question.");
  }

  if (/[\n•]/.test(question)) {
    throw new GeminiQuestionServiceError("Gemini question must be a single sentence, not a list.");
  }

  if (bannedQuestionLanguage.some((pattern) => pattern.test(trimmed))) {
    throw new GeminiQuestionServiceError("Gemini question used forbidden product language.");
  }

  return trimmed;
}

async function callGemini(input: string): Promise<Record<string, unknown>> {
  const response = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getGeminiApiKey(),
    },
    body: JSON.stringify({
      model: getGeminiQuestionModel(),
      store: false,
      system_instruction: systemInstruction(),
      input,
      generation_config: {
        temperature: 0.6,
        thinking_level: "low",
      },
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as GeminiInteractionResponse;

  if (!response.ok) {
    throw new GeminiQuestionServiceError(
      payload.error?.message ?? `Gemini API request failed with ${response.status}.`,
    );
  }

  return parseJsonObject(extractGeminiText(payload));
}

function publicObservationShape(observation: ObservationDto) {
  return {
    id: observation.id,
    text: observation.observationText,
    confirmationState: observation.confirmationState,
    blockedForQuestioning: observation.blockedForQuestioning,
  };
}

function publicTurnShape(turn: TurnDto) {
  return {
    speaker: turn.speaker,
    content: turn.content,
    questionFocus: turn.questionFocus,
    sourceObservationIds: turn.sourceObservationIds,
  };
}

function baseSessionContext(session: CoachSessionDto) {
  return {
    genre: session.genre,
    situation: session.situation,
    characterContext: session.characterContext,
    subtext: session.subtext || null,
    acceptedObservations: session.observations
      .filter(
        (observation) =>
          observation.confirmationState === "accepted" &&
          !observation.blockedForQuestioning,
      )
      .map(publicObservationShape),
    unavailableObservations: session.observations
      .filter(
        (observation) =>
          observation.confirmationState !== "accepted" ||
          observation.blockedForQuestioning,
      )
      .map((observation) => ({ id: observation.id, confirmationState: observation.confirmationState })),
    recentTurns: session.turns
      .slice(-MAX_RECENT_DIALOGUE_TURNS)
      .map(publicTurnShape),
  };
}

function normalizeQuestionFocus(
  value: unknown,
  allowed: GeminiQuestionFocus[],
  fallback: GeminiQuestionFocus,
): GeminiQuestionFocus {
  return typeof value === "string" && allowed.includes(value as GeminiQuestionFocus)
    ? (value as GeminiQuestionFocus)
    : fallback;
}

function getRequiredQuestionFocus(
  value: unknown,
  allowed: GeminiQuestionFocus[],
): GeminiQuestionFocus {
  if (typeof value !== "string" || !allowed.includes(value as GeminiQuestionFocus)) {
    throw new GeminiQuestionServiceError(
      "Gemini response questionFocus did not match dialogueSufficient.",
    );
  }

  return value as GeminiQuestionFocus;
}

export const geminiQuestionService = {
  async createInitialQuestion(input: CreateSessionRequest): Promise<InitialQuestionResult> {
    const payload = await callGemini(
      [
        "다음 업로드 세션의 첫 관찰 확인 문장과 첫 질문을 만들어라.",
        "observationText는 영상 장면을 직접 본 것처럼 쓰지 말고, 사용자가 입력한 장면 맥락에서 확인해야 할 지점으로만 쓴다.",
        "반환 JSON schema: {\"observationText\": string, \"confidence\": number, \"question\": string, \"questionFocus\": \"observation_confirmation\" | \"missing_context\"}",
        safeJsonForPrompt({
          genre: input.genre,
          situation: input.situation,
          characterContext: input.characterContext,
          subtext: input.subtext || null,
        }),
      ].join("\n\n"),
    );

    const question = ensureSafeSingleQuestion(getRequiredText(payload, "question"));
    const observationText = getRequiredText(payload, "observationText").replace(/\s+/g, " ").trim();

    if (observationText.length < 8 || observationText.length > 260) {
      throw new GeminiQuestionServiceError("Gemini observation text length is outside the allowed range.");
    }

    return {
      observationText,
      confidence: getConfidence(payload),
      question,
      questionFocus: normalizeQuestionFocus(
        payload.questionFocus,
        ["observation_confirmation", "missing_context"],
        "observation_confirmation",
      ) as InitialQuestionResult["questionFocus"],
    };
  },

  async createObservationFollowUp(
    session: CoachSessionDto,
    confirmationState: string,
  ): Promise<GeneratedQuestionResult> {
    const acceptedObservationIds = session.observations
      .filter(
        (observation) =>
          observation.confirmationState === "accepted" &&
          !observation.blockedForQuestioning,
      )
      .map((observation) => observation.id);
    const fallbackFocus = acceptedObservationIds.length > 0 ? "subtext_probe" : "missing_context";
    const payload = await callGemini(
      [
        "관찰 확인 직후 이어질 질문 하나를 만들어라.",
        "반환 JSON schema: {\"question\": string, \"questionFocus\": \"missing_context\" | \"subtext_probe\"}",
        safeJsonForPrompt({
          confirmationState,
          ...baseSessionContext(session),
        }),
      ].join("\n\n"),
    );

    return {
      question: ensureSafeSingleQuestion(getRequiredText(payload, "question")),
      questionFocus: normalizeQuestionFocus(
        payload.questionFocus,
        ["missing_context", "subtext_probe"],
        fallbackFocus,
      ),
    };
  },

  async createNextQuestion(
    session: CoachSessionDto,
    actorAnswer: string,
  ): Promise<NextQuestionResult> {
    const nextActorAnswerCount =
      session.turns.filter((turn) => turn.speaker === "actor").length + 1;
    const payload = await callGemini(
      [
        "사용자의 방금 답변 다음에 이어질 질문 하나를 만들어라.",
        "dialogueSufficient는 현재까지의 답변만으로 인물의 당장 원하는 것, 숨기는 생각이나 감정, 관계의 갈등, 선택하려는 행동을 지어내지 않고 정리할 만큼 구체적인 경우에만 true인 JSON boolean으로 반환한다.",
        `nextActorAnswerCount가 ${MIN_DIALOGUE_ANSWER_COUNT}보다 작으면 dialogueSufficient는 반드시 false이고 부족한 한 지점을 묻는 계속 질문을 만든다.`,
        `nextActorAnswerCount가 ${MIN_DIALOGUE_ANSWER_COUNT} 이상 ${MAX_DIALOGUE_ANSWER_COUNT}보다 작으면 답변 내용의 충분성을 판단하고, true이면 사용자가 자기 말로 정리하도록 돕는 마지막 성찰 질문을 만든다.`,
        `nextActorAnswerCount가 ${MAX_DIALOGUE_ANSWER_COUNT} 이상이면 dialogueSufficient는 반드시 true이고 마지막 성찰 질문을 만든다.`,
        "반환 JSON schema: {\"question\": string, \"questionFocus\": \"missing_context\" | \"subtext_probe\" | \"summary_reflection\", \"dialogueSufficient\": boolean}",
        safeJsonForPrompt({
          actorAnswer,
          nextActorAnswerCount,
          ...baseSessionContext(session),
        }),
      ].join("\n\n"),
    );
    const dialogueSufficient = getRequiredBoolean(
      payload,
      "dialogueSufficient",
    );
    const requiredDialogueSufficiency =
      requiredDialogueSufficiencyForAnswerCount(nextActorAnswerCount);

    if (
      !matchesRequiredDialogueSufficiency(
        nextActorAnswerCount,
        dialogueSufficient,
      )
    ) {
      throw new GeminiQuestionServiceError(
        `Gemini response field dialogueSufficient must be ${requiredDialogueSufficiency} at answer ${nextActorAnswerCount}.`,
      );
    }
    const allowedQuestionFocus: GeminiQuestionFocus[] = dialogueSufficient
      ? ["summary_reflection"]
      : ["missing_context", "subtext_probe"];

    return {
      question: ensureSafeSingleQuestion(getRequiredText(payload, "question")),
      questionFocus: getRequiredQuestionFocus(
        payload.questionFocus,
        allowedQuestionFocus,
      ),
      dialogueSufficient,
    };
  },

  async createQuestionToRevisit(
    session: CoachSessionDto,
    finalActorSentence: string,
  ): Promise<string> {
    const payload = await callGemini(
      [
        "세션을 마무리하며 사용자가 다음 연습에서 다시 볼 질문 하나를 만들어라.",
        "반환 JSON schema: {\"question\": string}",
        safeJsonForPrompt({
          finalActorSentence,
          ...baseSessionContext(session),
        }),
      ].join("\n\n"),
    );

    return ensureSafeSingleQuestion(getRequiredText(payload, "question"));
  },
};
