import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = readFileSync(
  path.resolve(import.meta.dirname, "../src/features/practice/practice-flow.tsx"),
  "utf8",
);

test("initial analysis failures retain and refresh the persisted session id", () => {
  assert.match(source, /let persistedSessionId: string \| null = null/);
  assert.match(source, /persistedSessionId = uploadIntent\.sessionId/);
  assert.match(source, /persistedSessionId\s*\?[\s\S]*recoverPersistedSession\(persistedSessionId, reason\)/);
});

test("analysis retry refreshes every persisted terminal classification", () => {
  assert.match(source, /await retryPracticeAnalysis\(active\.id, attempt\.requestId\)/);
  assert.match(source, /await recoverPersistedSession\(active\.id, reason\)/);
  assert.match(source, /reconcilePersistedMutation/);
  assert.match(source, /analysisStatus === "failed" && session\.take\.analysisRetryable/);
  assert.match(source, /analysisStatus === "failed" && !session\.take\.analysisRetryable/);
});
