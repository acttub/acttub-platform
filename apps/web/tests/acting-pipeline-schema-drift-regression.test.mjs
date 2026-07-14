import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const repository = readFileSync(
  new URL("../src/server/repositories/supabase-coach-session-repository.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/server/services/acting-coach-service.ts", import.meta.url),
  "utf8",
);

test("Supabase persistence errors retain PostgREST error codes", () => {
  const persistenceGuard = repository.match(
    /const assertNoPersistenceError = \([\s\S]*?\n\};/,
  )?.[0];

  assert.ok(persistenceGuard);
  assert.match(repository, /readonly code\?: string/);
  assert.match(
    persistenceGuard,
    /new SupabaseCoachSessionPersistenceError\([\s\S]*?error\.code,[\s\S]*?\);/,
  );
});

test("missing acting schema is returned as an actionable service error", () => {
  assert.match(service, /"PGRST202"/);
  assert.match(
    service,
    /if \(error\.code && actingSchemaErrorCodes\.has\(error\.code\)\) \{[\s\S]*?new ActingServiceError\(\s*503,\s*"acting_pipeline_not_ready",[\s\S]*?\{ dependency: "supabase_schema" \},[\s\S]*?\);[\s\S]*?\}/,
  );
});
