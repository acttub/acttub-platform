import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/practice/practice-flow.tsx"), "utf8");

test("candidate review is bounded, sequential and correction-aware", () => {
  assert.match(source, /observations\.slice\(0, 3\)/);
  assert.match(source, /confirmationState === "unasked"/);
  assert.match(source, /confirmPipelineObservation/);
  assert.match(source, /correction: correction\.trim\(\)/);
});

test("interview transitions are server driven with persisted counts", () => {
  for (const client of ["startPipelineInterview", "appendPipelineInterviewTurn", "stopPipelineInterview", "resumePipelineInterview", "getPipelinePracticeSession"]) {
    assert.match(source, new RegExp(client));
  }
  assert.match(source, /expectedSubstantiveAnswerCount: pipelineSession\.substantiveAnswerCount/);
  assert.match(source, /expectedTotalConversationCount: pipelineSession\.transcript\.filter\(\(item\) => item\.role === "actor" && \(item\.kind === "answer" \|\| item\.kind === "unknown"\)\)\.length/);
  assert.match(source, /session\.interviewStatus === "paused"/);
  assert.match(source, /session\.interviewStatus === "completed_without_report"/);
  assert.match(source, /session\.substantiveAnswerCount >= MAX_DIALOGUE_ANSWER_COUNT/);
});

test("report status is hidden without an accepted persisted observation", () => {
  assert.match(source, /accepted && !session\.report/);
  assert.match(source, /session\.report && accepted/);
  assert.match(source, /completed && !accepted/);
});
