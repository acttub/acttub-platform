import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/server/services/ai-pipeline-service.ts"), "utf8");

test("terminal agent turns are committed through the append pipeline transaction", () => {
  const callAgent = source.slice(source.indexOf("const callAgent"), source.lastIndexOf("\nreturn {\n"));
  assert.match(callAgent, /completionStatus:\s*invoked\.done \|\| String\(invoked\.response\.action\) === "pause" \? \(invoked\.reportReady \? "completed" : String\(invoked\.response\.action\) === "pause" \? "paused" : "completed_without_report"\) : null/);
  assert.match(callAgent, /deps\.repository\.appendPipelineTurn\(\{[\s\S]*completionStatus:[\s\S]*completionReason:\s*invoked\.done \|\| String\(invoked\.response\.action\) === "pause"/);
  assert.doesNotMatch(callAgent, /completeInterview\(\{/);
});

test("early insufficient evidence still uses the explicit completion RPC", () => {
  assert.match(source, /if \(!session\.observations\.some\(\(item\) => item\.confirmationState === "accepted" && !item\.blockedForQuestioning\)\) \{ await deps\.repository\.completeInterview\(\{ sessionId, userId, status: "completed_without_report", completionReason: "insufficient_confirmed_evidence", observationIds: \[\], answerTurnIds: \[\] \}\); return \{ done: true, completionReason: "insufficient_confirmed_evidence", reportReady: false \}; \}/);
});

test("deletion cleanup uses the hidden session lookup and fail-closed storage/rows rollback path", () => {
  assert.match(source, /coachSessionService\.getSessionIncludingHidden\(sessionId,userId\)/);
  assert.match(source, /const code=storageDeleted\?"DELETE_ROWS_FAILED":"DELETE_STORAGE_FAILED"/);
  assert.match(source, /repository\.failDelete\(\{sessionId,userId,requestId,safeErrorCode:code\}\)/);
  assert.doesNotMatch(source, /fetch\(/);
});
