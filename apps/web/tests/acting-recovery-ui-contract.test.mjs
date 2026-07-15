import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const flow = readFileSync(path.join(root, "src/features/practice/practice-flow.tsx"), "utf8");
const types = readFileSync(path.join(root, "src/lib/api/types.ts"), "utf8");
const openapi = JSON.parse(readFileSync(path.join(root, "src/lib/api/openapi.json"), "utf8"));

test("retryable delivery is public and documented without private fields", () => {
  assert.match(types, /deliveryRetryable\?: boolean/);
  assert.equal(openapi.components.schemas.PracticeTurn.properties.deliveryRetryable.type, "boolean");
  assert.doesNotMatch(types, /actingSessionId|leaseToken/);
});

test("UI distinguishes start, reply, and terminal analysis recovery", () => {
  assert.match(flow, /recoveryAction === "start"/);
  assert.match(flow, /operation: "retry_reply"/);
  assert.match(flow, /actorTurnId/);
  assert.match(flow, /onRetryReply\(retryableActorTurn\.id\)/);
  assert.match(flow, /analysisStatus === "failed" && !session\.take\.analysisRetryable/);
  assert.match(flow, /새 연습 세션을 시작해 주세요/);
  assert.match(flow, /reconcilePersistedMutation/);
  assert.doesNotMatch(flow, /if \(!\(reason instanceof ApiClientError\)/);
  assert.match(flow, /status === "start_failed" && !session\.currentRun\.failureRetryable/);
});
