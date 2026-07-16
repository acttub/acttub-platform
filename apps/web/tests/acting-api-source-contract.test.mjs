import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");

test("acting-api credentials and direct upstream calls stay server-only", () => {
  const client = [
    read("src/lib/api/types.ts"),
    read("src/lib/api/sessions.ts"),
    read("src/features/practice/practice-flow.tsx"),
  ].join("\n");
  assert.doesNotMatch(client, /ACTING_API_KEY|X-API-Key|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /https?:[^\s"`]*(?:\/summarize|\/coach\/start|\/coach\/reply|\/report)/);
});

test("active source removes Gemini-era observation and authored-summary flow", () => {
  const active = [
    read("src/lib/api/types.ts"),
    read("src/lib/api/sessions.ts"),
    read("src/features/practice/practice-flow.tsx"),
  ].join("\n");
  assert.doesNotMatch(active, /OBSERVE_CONFIRM|PROBE_LOOP|finalActorSentence|dialogueComplete|completionReason/);
  assert.doesNotMatch(active, /createPracticeSummary|updatePracticeObservation|saveValidationMetrics/);
});

test("typed client exposes only the locked acting operations", () => {
  const client = [read("src/lib/api/types.ts"), read("src/lib/api/sessions.ts")].join("\n");
  assert.match(client, /operation:\s*"start"/);
  assert.match(client, /operation:\s*"reply"/);
  assert.match(client, /operation:\s*"retry_reply"/);
  assert.match(client, /operation:\s*"restart"/);
  assert.match(client, /\/analysis/);
  assert.match(client, /\/report/);
});

test("active session input forwards only the summarize scene context", () => {
  const types = read("src/lib/api/types.ts");
  const service = read("src/server/services/acting-coach-service.ts");
  const requestType = types.match(/export type CreateActingSessionRequest = \{[\s\S]*?\n\};/)?.[0] ?? "";

  assert.doesNotMatch(requestType, /\bmedium\b|\bgenre\b/);
  assert.match(requestType, /\bsituation:\s*string/);
  assert.match(requestType, /\bcharacterContext:\s*string/);
  assert.match(requestType, /\bsubtext:\s*string/);
  assert.match(service, /situation:\s*String\(source\.situation\)/);
  assert.match(service, /situation:\s*claim\.coachContext\?\.situation/);
  assert.doesNotMatch(service, /formattedSituation/);
});
