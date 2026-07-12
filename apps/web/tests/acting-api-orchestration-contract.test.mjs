import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

test("coach response parsing follows the documented acting-api shape", () => {
  const guards = read("src/server/acting-api/response-guards.ts");
  const service = read("src/server/services/acting-coach-service.ts");

  assert.match(guards, /response\.utterance/);
  assert.match(guards, /response\.reason/);
  assert.doesNotMatch(guards, /response\.question|response\.close_reason/);
  assert.match(service, /question:\s*response\.utterance/);
  assert.match(service, /closeReason:\s*response\.reason\s*\?\?\s*""/);
});

test("upstream failures preserve phase-specific recovery semantics", () => {
  const service = read("src/server/services/acting-coach-service.ts");

  assert.match(service, /analysis_outcome_unknown/);
  assert.match(service, /upstream_outcome_unknown/);
  assert.match(service, /report_outcome_unknown/);
  assert.match(service, /acting_api_invalid_response/);
  assert.match(service, /create_new_session/);
  assert.match(service, /restart_interview/);
  assert.match(service, /contact_support/);
  assert.match(service, /phase\s*===\s*"coach"[\s\S]*response\.status\s*===\s*404/);
});

test("create and report return 200 only for completed replays", () => {
  const createRoute = read("src/app/api/v1/practice-sessions/route.ts");
  const reportRoute = read("src/app/api/v1/practice-sessions/[sessionId]/report/route.ts");

  for (const route of [createRoute, reportRoute]) {
    assert.match(route, /result\.replayed\s*\?\s*200\s*:\s*201/);
    assert.match(route, /jsonResponse\(result\.value/);
  }
});

test("local completion retries reuse generated persistence identifiers", () => {
  const service = read("src/server/services/acting-coach-service.ts");

  assert.match(service, /const sceneSummaryId = crypto\.randomUUID\(\);[\s\S]*retryLocalCommit/);
  assert.match(service, /const aiTurnId = crypto\.randomUUID\(\);[\s\S]*retryLocalCommit/);
  assert.match(service, /const reportId = crypto\.randomUUID\(\);[\s\S]*retryLocalCommit/);
});
