export const MIN_DIALOGUE_ANSWER_COUNT = 5;
export const MAX_DIALOGUE_ANSWER_COUNT = 10;

export type DialogueCompletionReason =
  | "ai_sufficient"
  | "max_questions_reached"
  | null;

export type DialogueCompletionPolicyResult = {
  dialogueComplete: boolean;
  completionReason: DialogueCompletionReason;
};

function assertValidAnswerCount(answerCount: number): void {
  if (!Number.isInteger(answerCount) || answerCount < 0) {
    throw new RangeError("answerCount must be a non-negative integer.");
  }
}

export function requiredDialogueSufficiencyForAnswerCount(
  answerCount: number,
): boolean | null {
  assertValidAnswerCount(answerCount);

  if (answerCount < MIN_DIALOGUE_ANSWER_COUNT) return false;
  if (answerCount >= MAX_DIALOGUE_ANSWER_COUNT) return true;
  return null;
}

export function matchesRequiredDialogueSufficiency(
  answerCount: number,
  dialogueSufficient: boolean,
): boolean {
  const required = requiredDialogueSufficiencyForAnswerCount(answerCount);
  return required === null || dialogueSufficient === required;
}

export function evaluateDialogueCompletionPolicy(
  answerCount: number,
  aiSufficient: boolean,
): DialogueCompletionPolicyResult {
  assertValidAnswerCount(answerCount);

  if (answerCount >= MAX_DIALOGUE_ANSWER_COUNT) {
    return {
      dialogueComplete: true,
      completionReason: "max_questions_reached",
    };
  }

  if (answerCount < MIN_DIALOGUE_ANSWER_COUNT || !aiSufficient) {
    return {
      dialogueComplete: false,
      completionReason: null,
    };
  }

  return {
    dialogueComplete: true,
    completionReason: "ai_sufficient",
  };
}
