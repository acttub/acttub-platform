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
  assert.doesNotMatch(client, /\/summarize|\/coach\/start|\/coach\/reply|\/report/);
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
  const client = read("src/lib/api/sessions.ts");
  assert.match(client, /operation:\s*"start"/);
  assert.match(client, /operation:\s*"reply"/);
  assert.match(client, /operation:\s*"retry_reply"/);
  assert.match(client, /operation:\s*"restart"/);
  assert.match(client, /\/analysis/);
  assert.match(client, /\/report/);
});
