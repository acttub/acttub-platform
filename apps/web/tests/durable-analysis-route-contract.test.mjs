import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("analysis create and retry enqueue and return 202 without route-owned execution", () => {
  const createRoute = read("src/app/api/v1/practice-sessions/route.ts");
  const retryRoute = read("src/app/api/v1/practice-sessions/[sessionId]/analysis/route.ts");
  const service = read("src/server/services/acting-coach-service.ts");

  assert.doesNotMatch(createRoute, /maxDuration/);
  assert.doesNotMatch(retryRoute, /maxDuration/);
  assert.match(createRoute, /result\.accepted\s*\?\s*202\s*:\s*200/);
  assert.match(retryRoute, /result\.accepted\s*\?\s*202\s*:\s*200/);
  assert.match(service, /enqueueAnalysisCreate/);
  assert.match(service, /enqueueAnalysisRetry/);
  const createService = service.slice(service.indexOf("async createSession("), service.indexOf("async retryAnalysis("));
  const retryService = service.slice(service.indexOf("async retryAnalysis("), service.indexOf("async turn("));
  assert.doesNotMatch(createService + retryService, /requireActingConfig/);
  assert.doesNotMatch(service, /runAnalysisClaim/);
  assert.doesNotMatch(createRoute + retryRoute, /summarize|setTimeout|after\s*\(|void\s+\w+\s*\(/);
});
