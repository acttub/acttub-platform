import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { classifyUpstreamFailure } from "../src/server/acting-api/upstream-response-classification.ts";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const service = readFileSync(
  path.join(appRoot, "src/server/services/acting-coach-service.ts"),
  "utf8",
);
const migrationPath = path.join(
  repoRoot,
  "supabase/migrations/020_fastapi_422_definitive.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const runtimePreflight = readFileSync(
  path.join(appRoot, "scripts/check-acting-runtime.mjs"),
  "utf8",
);

test("FastAPI request-validation 422 is definitive for every acting operation", () => {
  for (const operation of ["analysis", "coach_start", "coach_reply", "report"]) {
    assert.equal(classifyUpstreamFailure(operation, 422), "contract_mismatch");
  }

  assert.match(
    service,
    /failure === "contract_mismatch"[\s\S]*"acting_api_contract_mismatch"[\s\S]*"The acting service could not accept this request\."/,
  );
  assert.match(service, /isDefinitive[\s\S]*acting_api_contract_mismatch/);
  assert.match(service, /acting_api_contract_mismatch[\s\S]*return 502/);
  assert.ok(
    service.indexOf('failure === "contract_mismatch"') <
      service.indexOf("return await response.json()"),
    "422 must be classified before any upstream validation body is parsed",
  );
  assert.match(
    runtimePreflight,
    /coach\/start[\s\S]*body: "\{\}"[\s\S]*authProbe\.status !== 422/,
    "the FastAPI validation-before-handler runtime premise must remain executable",
  );
});

test("422 persistence is failed, replayable, and recoverable with a new request ID", () => {
  assert.match(
    migration,
    /acting_api_contract_mismatch[\s\S]*The acting service could not accept this request\./,
  );
  assert.match(
    migration,
    /analysis_retryable=\(p_failure_class='definitive' and p_safe_error_code in \([^)]*'acting_api_contract_mismatch'/,
  );
  assert.match(
    migration,
    /delivery_retryable=\(p_failure_class='definitive' and p_safe_error_code in \([^)]*'acting_api_contract_mismatch'/,
  );
  assert.match(
    migration,
    /failure_retryable=\(p_failure_class='definitive' and p_safe_error_code in \([^)]*'acting_api_contract_mismatch'/,
  );
  assert.match(
    migration,
    /status='failed' and safe_error_code not in \([^)]*'acting_api_contract_mismatch'/,
  );
  assert.doesNotMatch(
    migration,
    /p_safe_error_code='acting_api_contract_mismatch'[^\n]*then 'outcome_unknown'/,
  );
});

test("existing definitive and ambiguous status classifications stay unchanged", () => {
  const operations = ["analysis", "coach_start", "coach_reply", "report"];
  for (const operation of operations) {
    assert.equal(classifyUpstreamFailure(operation, 400), "request_rejected");
    assert.equal(classifyUpstreamFailure(operation, 401), "auth_failed");
    assert.equal(classifyUpstreamFailure(operation, 429), "rate_limited");
    assert.equal(classifyUpstreamFailure(operation, 500), "unavailable");
  }
  assert.equal(classifyUpstreamFailure("analysis", 413), "video_too_large");
  assert.equal(classifyUpstreamFailure("coach_start", 413), "request_rejected");
  assert.equal(classifyUpstreamFailure("coach_reply", 404), "session_expired");
  assert.equal(classifyUpstreamFailure("coach_start", 404), "route_not_found");
});
