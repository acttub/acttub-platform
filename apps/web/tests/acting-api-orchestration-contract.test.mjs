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
  const classification = read("src/server/acting-api/upstream-response-classification.ts");

  assert.match(service, /analysis_outcome_unknown/);
  assert.match(service, /upstream_outcome_unknown/);
  assert.match(service, /report_outcome_unknown/);
  assert.match(service, /acting_api_invalid_response/);
  assert.match(service, /create_new_session/);
  assert.match(service, /restart_interview/);
  assert.match(service, /contact_support/);
  assert.match(classification, /operation\s*===\s*"coach_reply"[\s\S]*status\s*===\s*404/);
});

test("analysis enqueue returns 202 while report keeps synchronous replay status", () => {
  const createRoute = read("src/app/api/v1/practice-sessions/route.ts");
  const reportRoute = read("src/app/api/v1/practice-sessions/[sessionId]/report/route.ts");

  assert.match(createRoute, /result\.accepted\s*\?\s*202\s*:\s*200/);
  assert.match(reportRoute, /result\.replayed\s*\?\s*200\s*:\s*201/);
  assert.match(createRoute, /jsonResponse\(result\.value/);
  assert.match(reportRoute, /jsonResponse\(result\.value/);
});

test("long-running analysis is owned by the independent worker", () => {
  const worker = read("workers/analysis-worker.mjs");
  const routes = [
    read("src/app/api/v1/practice-sessions/route.ts"),
    read("src/app/api/v1/practice-sessions/[sessionId]/analysis/route.ts"),
  ];

  for (const route of routes) {
    assert.doesNotMatch(route, /maxDuration|summarize/);
  }
  assert.match(worker, /ANALYSIS_WORKER_UPSTREAM_TIMEOUT_MS/);
  assert.match(worker, /900000/);
});

test("local completion retries reuse generated persistence identifiers", () => {
  const service = read("src/server/services/acting-coach-service.ts");

  const worker = read("workers/lib/analysis-job-runner.mjs");
  assert.match(worker, /repository\.complete\(job, leaseToken, randomUUID\(\), summary\)/);
  assert.match(service, /const aiTurnId = crypto\.randomUUID\(\);[\s\S]*retryLocalCommit/);
  assert.match(service, /const reportId = crypto\.randomUUID\(\);[\s\S]*retryLocalCommit/);
});
