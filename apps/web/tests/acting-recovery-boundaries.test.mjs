import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");

test("soft hide returns the public acting-or-legacy session union", () => {
  const repository = read("src/server/repositories/supabase-coach-session-repository.ts");
  const service = read("src/server/services/coach-session-service.ts");
  const updateVisibility = repository.slice(repository.indexOf("async updatePublicVisibility("));

  assert.match(updateVisibility, /Promise<CoachSessionDto \| null>/);
  assert.match(updateVisibility, /return hydrateSession\(sessionId, userId, true\)/);
  assert.doesNotMatch(updateVisibility, /return hydrateLegacySession\(/);
  assert.match(service, /updatePublicVisibility\(sessionId, userId, true\)/);
  assert.match(service, /Promise<\{ session: PublicCoachSessionDto \} \| null>/);
});

test("retryable actor delivery state is present in the public DTO and OpenAPI", () => {
  const types = read("src/lib/api/types.ts");
  const repository = read("src/server/repositories/supabase-coach-session-repository.ts");
  const openApi = JSON.parse(read("src/lib/api/openapi.json"));

  assert.match(types, /deliveryRetryable\?: boolean;/);
  assert.match(repository, /deliveryRetryable: asBoolean\(turn\.delivery_retryable\)/);
  assert.equal(
    openApi.components.schemas.PracticeTurn.properties.deliveryRetryable.type,
    "boolean",
  );
});

test("acting UI exposes start retry, actor retry, and terminal analysis recovery", () => {
  const flow = read("src/features/practice/practice-flow.tsx");

  assert.match(flow, /operation: "retry_reply"/);
  assert.match(flow, /actorTurnId/);
  assert.match(flow, /recoveryAction === "start"/);
  assert.match(flow, /analysisStatus === "failed" && !session\.take\.analysisRetryable/);
});
