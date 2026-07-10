import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_DIALOGUE_ANSWER_COUNT,
  MIN_DIALOGUE_ANSWER_COUNT,
  evaluateDialogueCompletionPolicy,
  matchesRequiredDialogueSufficiency,
  requiredDialogueSufficiencyForAnswerCount,
} from "../src/lib/practice/dialogue-completion-policy.ts";

test("dialogue completion policy requires false below five answers", () => {
  assert.equal(MIN_DIALOGUE_ANSWER_COUNT, 5);
  assert.equal(requiredDialogueSufficiencyForAnswerCount(4), false);
  assert.equal(matchesRequiredDialogueSufficiency(4, false), true);
  assert.equal(matchesRequiredDialogueSufficiency(4, true), false);
  assert.deepEqual(evaluateDialogueCompletionPolicy(4, true), {
    dialogueComplete: false,
    completionReason: null,
  });
});

test("dialogue completion policy honors AI sufficiency from five through nine answers", () => {
  for (const answerCount of [5, 9]) {
    assert.equal(requiredDialogueSufficiencyForAnswerCount(answerCount), null);
    assert.equal(matchesRequiredDialogueSufficiency(answerCount, false), true);
    assert.equal(matchesRequiredDialogueSufficiency(answerCount, true), true);
    assert.deepEqual(evaluateDialogueCompletionPolicy(answerCount, false), {
      dialogueComplete: false,
      completionReason: null,
    });
    assert.deepEqual(evaluateDialogueCompletionPolicy(answerCount, true), {
      dialogueComplete: true,
      completionReason: "ai_sufficient",
    });
  }
});

test("dialogue completion policy forces completion at ten answers", () => {
  assert.equal(MAX_DIALOGUE_ANSWER_COUNT, 10);
  assert.equal(
    requiredDialogueSufficiencyForAnswerCount(MAX_DIALOGUE_ANSWER_COUNT),
    true,
  );
  assert.equal(
    matchesRequiredDialogueSufficiency(MAX_DIALOGUE_ANSWER_COUNT, false),
    false,
  );
  assert.equal(
    matchesRequiredDialogueSufficiency(MAX_DIALOGUE_ANSWER_COUNT, true),
    true,
  );
  for (const aiSufficient of [false, true]) {
    assert.deepEqual(
      evaluateDialogueCompletionPolicy(MAX_DIALOGUE_ANSWER_COUNT, aiSufficient),
      {
        dialogueComplete: true,
        completionReason: "max_questions_reached",
      },
    );
  }
});

test("dialogue completion policy rejects invalid persisted counts", () => {
  for (const answerCount of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => evaluateDialogueCompletionPolicy(answerCount, false),
      /non-negative integer/,
    );
  }
});

test("Gemini returns a strict boolean decision with the full bounded dialogue context", () => {
  const source = readFileSync(
    new URL("../src/server/services/gemini-question-service.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /typeof value !== "boolean"/);
  assert.match(source, /getRequiredBoolean\(\s*payload,\s*"dialogueSufficient"/);
  assert.match(
    source,
    /MAX_RECENT_DIALOGUE_TURNS = MAX_DIALOGUE_ANSWER_COUNT \* 2 \+ 2/,
  );
  assert.match(source, /nextActorAnswerCount가 \$\{MIN_DIALOGUE_ANSWER_COUNT\}보다 작으면/);
  assert.match(source, /nextActorAnswerCount가 \$\{MAX_DIALOGUE_ANSWER_COUNT\} 이상이면/);
  assert.match(source, /requiredDialogueSufficiencyForAnswerCount\(nextActorAnswerCount\)/);
  assert.match(source, /matchesRequiredDialogueSufficiency\(/);
  assert.match(source, /getRequiredQuestionFocus\(/);
  assert.match(
    source,
    /Gemini response questionFocus did not match dialogueSufficient/,
  );
  assert.match(source, /throw new GeminiQuestionServiceError/);
});

test("turn creation applies persisted-count guards and returns the additive contract", () => {
  const service = readFileSync(
    new URL("../src/server/services/coach-session-service.ts", import.meta.url),
    "utf8",
  );
  const types = readFileSync(
    new URL("../src/lib/api/types.ts", import.meta.url),
    "utf8",
  );
  const repository = readFileSync(
    new URL(
      "../src/server/repositories/supabase-coach-session-repository.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const openApi = JSON.parse(
    readFileSync(new URL("../src/lib/api/openapi.json", import.meta.url), "utf8"),
  );

  assert.match(service, /existingAnswerCount = session\.turns\.filter/);
  assert.match(service, /latestCoachTurn\?\.questionFocus === "summary_reflection"/);
  assert.match(service, /existingAnswerCount >= MAX_DIALOGUE_ANSWER_COUNT/);
  assert.match(service, /evaluateDialogueCompletionPolicy\(/);
  assert.match(
    service,
    /completion\.dialogueComplete !== generatedQuestion\.dialogueSufficient/,
  );
  assert.match(
    service,
    /\(generatedQuestion\.questionFocus === "summary_reflection"\) !==\s*completion\.dialogueComplete/,
  );
  assert.match(service, /existingAnswerCount,\s*\)/);
  assert.match(service, /answerCount: persistedTurnPair\.actorAnswerCount/);
  assert.match(
    repository,
    /p_expected_actor_answer_count: expectedActorAnswerCount/,
  );
  assert.match(
    repository,
    /actorAnswerCount !== expectedActorAnswerCount \+ 1/,
  );

  for (const field of [
    "dialogueComplete",
    "answerCount",
    "completionReason",
  ]) {
    assert.match(types, new RegExp(`${field}:`));
    assert.ok(
      openApi.components.schemas.CreateTurnResponse.required.includes(field),
      `${field} must be required by OpenAPI`,
    );
  }

  assert.deepEqual(
    openApi.components.schemas.CreateTurnResponse.properties.completionReason.enum,
    ["ai_sufficient", "max_questions_reached", null],
  );
});
