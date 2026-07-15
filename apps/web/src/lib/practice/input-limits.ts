export const PRACTICE_INPUT_LIMITS = {
  sceneFieldCodePoints: 2_000,
  sceneAggregateCodePoints: 4_000,
  replyCodePoints: 2_000,
  jsonBodyBytes: 64 * 1_024,
} as const;

export class PracticeInputValidationError extends Error {
  readonly status = 400;
  readonly code = "validation_error";
  readonly details: Record<string, string>;

  constructor(message: string, details: Record<string, string>) {
    super(message);
    this.name = "PracticeInputValidationError";
    this.details = details;
  }
}

export const countUnicodeCodePoints = (value: string): number => [...value].length;

const normalizeSceneField = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new PracticeInputValidationError(`${field} is required.`, {
      [field]: `${field} is required.`,
    });
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  if (countUnicodeCodePoints(normalized) > PRACTICE_INPUT_LIMITS.sceneFieldCodePoints) {
    throw new PracticeInputValidationError(`${field} must be at most 2000 characters.`, {
      [field]: `${field} must be at most 2000 Unicode code points.`,
    });
  }
  return normalized;
};

export const validateSceneContext = (value: {
  situation?: unknown;
  characterContext?: unknown;
  subtext?: unknown;
}) => {
  const result = {
    situation: normalizeSceneField(value.situation, "situation"),
    characterContext: normalizeSceneField(value.characterContext, "characterContext"),
    subtext: normalizeSceneField(value.subtext, "subtext"),
  };
  const aggregate = Object.values(result).reduce(
    (total, field) => total + countUnicodeCodePoints(field),
    0,
  );
  if (aggregate > PRACTICE_INPUT_LIMITS.sceneAggregateCodePoints) {
    throw new PracticeInputValidationError("Scene context must be at most 4000 characters.", {
      sceneContext: "Scene context must be at most 4000 Unicode code points in aggregate.",
    });
  }
  return result;
};

export const validateReplyText = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new PracticeInputValidationError("text is required.", {
      text: "text is required.",
    });
  }
  const normalized = value.trim();
  if (countUnicodeCodePoints(normalized) > PRACTICE_INPUT_LIMITS.replyCodePoints) {
    throw new PracticeInputValidationError("text must be at most 2000 characters.", {
      text: "text must be at most 2000 Unicode code points.",
    });
  }
  return normalized;
};
