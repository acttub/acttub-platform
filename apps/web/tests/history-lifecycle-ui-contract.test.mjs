import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("history uses internal detail links and supports reversible visibility", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  assert.match(source, /import Link from "next\/link"/);
  assert.match(source, /pipelineVersion === "ai-pipeline\.v1" \? \([\s\S]*href=\{`\/practice\/history\/\$\{session\.id\}`\}/);
  assert.match(source, /updatePracticeSessionVisibility\(session\.id,[\s\S]*hidden: !session\.hiddenAt/);
  assert.match(source, /session\.hiddenAt \? "숨김 해제" : "숨기기"/);
});

test("hard deletion keeps one UUID idempotency key through polling and retry", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  assert.match(source, /deletionRequestIdRef\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(source, /deletePipelinePracticeSession\(session\.id, requestId\)/);
  assert.match(source, /getPipelineDeletionStatus\(session\.id, requestId\)/);
  assert.match(source, /deletion\.status === "completed"[\s\S]*onSessionDeleted\(session\.id\)/);
  assert.match(source, /deletionState === "delete_failed"[\s\S]*"삭제 다시 시도"/);
});

test("legacy history remains explicitly separated from the pipeline lifecycle", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  assert.match(source, /pipelineVersion: "ai-pipeline\.v1" \| null/);
  assert.match(source, /pipelineVersion === "ai-pipeline\.v1" \? "AI 연습 기록" : "이전 연습 기록"/);
  assert.doesNotMatch(source, /<a\s/);
  assert.doesNotMatch(source, /retryPipelineReport|backfill/i);
});

test("visibility route accepts both hide and unhide through the owner-scoped service", () => {
  const source = read("src/app/api/v1/practice-sessions/[sessionId]/visibility/route.ts");
  assert.match(source, /requireApiTermsAccepted\(\)/);
  assert.match(source, /coachSessionService\.updateVisibility\([\s\S]*sessionId,[\s\S]*auth\.userId,[\s\S]*body/);
  assert.doesNotMatch(source, /hidden !== true|softHideSession/);
});
