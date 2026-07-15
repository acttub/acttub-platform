import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  classifyUpstreamFailure,
  upstreamEndpoint,
} from "../src/server/acting-api/upstream-response-classification.ts";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const service = readFileSync(
  path.join(appRoot, "src/server/services/acting-coach-service.ts"),
  "utf8",
);
const actingMigration = readFileSync(
  path.join(repoRoot, "supabase/migrations/011_acting_api_pipeline.sql"),
  "utf8",
);

const startBranch = service.slice(
  service.indexOf('if (operation === "start" || operation === "restart")'),
  service.indexOf("const allowedKeys ="),
);
const replyBranch = service.slice(
  service.indexOf("const allowedKeys ="),
  service.indexOf("async getReport"),
);

test("coach 404 classification keeps start and reply operations distinct", () => {
  assert.match(startBranch, /parseUpstreamResponse\([\s\S]*"coach_start"/);
  assert.match(replyBranch, /parseUpstreamResponse\([\s\S]*"coach_reply"/);
  assert.equal(classifyUpstreamFailure("coach_start", 404), "route_not_found");
  assert.equal(classifyUpstreamFailure("coach_reply", 404), "session_expired");
  assert.equal(upstreamEndpoint("coach_start"), "/coach/start");
  assert.equal(upstreamEndpoint("coach_reply"), "/coach/reply");
});

test("start and restart 404 fail the operation without expiring the claimed run", () => {
  assert.doesNotMatch(startBranch, /expireCoachRun/);
  assert.match(startBranch, /failCoachOperation/);
  assert.match(
    service,
    /failure === "route_not_found"[\s\S]*502,[\s\S]*"acting_api_rejected"[\s\S]*"acting-api route was not found\."/,
  );
  assert.match(service, /acting_api_rejected[\s\S]*return 502/);
  assert.match(service, /isDefinitive[\s\S]*acting_api_rejected/);
  assert.match(
    actingMigration,
    /p_safe_error_code in \('acting_api_auth_failed','acting_api_rejected'\) then 502/,
  );
  assert.doesNotMatch(service, /acting_api_route_not_found/);
});

test("reply 404 retains session expiry and restart recovery semantics", () => {
  assert.match(replyBranch, /mapped\.code === "acting_session_expired"/);
  assert.match(replyBranch, /expireCoachRun\([\s\S]*actorTurnId/);
  assert.match(service, /acting_session_expired[\s\S]*action: "restart_interview"/);
});

test("operation-aware logging is safe and existing status mappings remain present", () => {
  assert.match(
    service,
    /console\.error\("acting-api upstream request failed", \{[\s\S]*operation,[\s\S]*endpoint: upstreamEndpoint\(operation\),[\s\S]*status: response\.status/,
  );
  assert.match(service, /failure === "auth_failed"[\s\S]*acting_api_auth_failed/);
  assert.match(service, /failure === "rate_limited"[\s\S]*acting_api_rate_limited/);
  assert.match(service, /failure === "video_too_large"[\s\S]*video_too_large/);
  assert.match(service, /failure === "unavailable"[\s\S]*ambiguousError/);
  assert.doesNotMatch(service, /console\.error\([^;]*(?:apiKey|payload|body)/s);
});

test("401, 429, and 5xx classifications remain stable for every operation", () => {
  const operations = ["analysis", "coach_start", "coach_reply", "report"];
  for (const operation of operations) {
    assert.equal(classifyUpstreamFailure(operation, 401), "auth_failed");
    assert.equal(classifyUpstreamFailure(operation, 429), "rate_limited");
    assert.equal(classifyUpstreamFailure(operation, 500), "unavailable");
  }
  assert.equal(classifyUpstreamFailure("analysis", 413), "video_too_large");
  assert.equal(classifyUpstreamFailure("coach_start", 413), "request_rejected");
  assert.equal(classifyUpstreamFailure("coach_reply", 413), "request_rejected");
  assert.equal(classifyUpstreamFailure("report", 413), "request_rejected");
});
