import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/server/services/ai-pipeline-service.ts"), "utf8");

test("terminal agent turns are committed through the append pipeline transaction", () => {
  const callAgent = source.slice(source.indexOf("const callAgent"), source.indexOf("export const aiPipelineService"));
  assert.match(callAgent, /completionStatus = done \|\| action === "pause" \? \(response\.reportReady \? "completed" : action === "pause" \? "paused" : "completed_without_report"\) : null/);
  assert.match(callAgent, /repository\.appendPipelineTurn\(\{[\s\S]*completionStatus,[\s\S]*completionReason: completionStatus \? response\.completionReason as never : null/);
  assert.doesNotMatch(callAgent, /repository\.completeInterview\(\{/);
});

test("early insufficient evidence still uses the explicit completion RPC", () => {
  assert.match(source, /if \(!session\.observations\.some\(\(item\) => item\.confirmationState === "accepted" && !item\.blockedForQuestioning\)\) \{ await repository\.completeInterview\(\{ sessionId, userId, status: "completed_without_report", completionReason: "insufficient_confirmed_evidence", observationIds: \[\], answerTurnIds: \[\] \}\); return \{ done: true, completionReason: "insufficient_confirmed_evidence", reportReady: false \}; \}/);
});
