import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");
const flow = read("apps", "web", "src", "features", "practice", "practice-flow.tsx");
const sessions = read("apps", "web", "src", "lib", "api", "sessions.ts");
const types = read("apps", "web", "src", "lib", "api", "types.ts");

async function importTypeScriptModule(...parts) {
  const source = read(...parts);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("G005 extends immutable migrations 011 through 017 without changing excluded review boundaries", () => {
  const migrationHashes = new Map([
    ["011_acting_api_pipeline.sql", "69d743df6fe9c3ebd1ddb56355c604e7f542ce1d204933bbdff08315153c2ee6"],
    ["012_canonical_consent_contract.sql", "d9e77e881f8b15614fe549d54a396a753205587976c9489e818a9d5f8beba20d"],
    ["013_scene_context_only.sql", "a2b8b2054d98431397c37bc9605664d2bd98ae168be52bba7421d26f40a01092"],
    ["014_lock_profile_and_terms_owners.sql", "d80d88cdeab177417650b3d2f3a71ee1129e605b3d4cfddf6a9e7b0bb496b629"],
    ["015_canonicalize_consent_versions.sql", "c1158f65016becccf8bd0486fd7be952180fcfe35cc9966e4fdbeb622f6e7467"],
    ["016_bound_practice_inputs.sql", "ac21aa2076373d72975d8d7a153ee60c9bac8652295bb411d099163361b77648"],
    ["017_reconnect_retry_reply_actor.sql", "38ba9f1a9a4570b223c1e67cae2d7113943db761212bddc43216f5280488d896"],
  ]);

  for (const [fileName, expectedHash] of migrationHashes) {
    const migration = read("supabase", "migrations", fileName);
    assert.equal(createHash("sha256").update(migration).digest("hex"), expectedHash);
  }

  assert.match(read("apps", "web", "src", "server", "acting-api", "config.ts"), /ACTING_API_KEY/);
  assert.doesNotMatch(read("apps", "web", "src", "app", "api", "v1", "practice-sessions", "[sessionId]", "turns", "route.ts"), /maxDuration/);
  assert.doesNotMatch(read("apps", "web", "src", "app", "api", "v1", "practice-sessions", "[sessionId]", "report", "route.ts"), /maxDuration/);
  assert.match(read("supabase", "migrations", "001_acttub_slice1_schema.sql"), /314572800/);
  assert.match(read("supabase", "migrations", "011_acting_api_pipeline.sql"), /576716800/);
});

test("public mutation identity fields are additive and backward compatible", () => {
  assert.match(types, /CreateUploadIntentRequest\s*=\s*\{[\s\S]*requestId\?:\s*string/);
  assert.match(
    types,
    /operation:\s*"reply";\s*runId:\s*string;\s*requestId:\s*string;\s*expectedAiTurnId\?:\s*string;\s*text:\s*string/,
  );
});

test("new normal replies identify the latest visible AI turn", () => {
  assert.match(flow, /operation:\s*"reply"[\s\S]*expectedAiTurnId:\s*[A-Za-z0-9_.]*latest[A-Za-z0-9_.]*AiTurn[A-Za-z0-9_.]*\.id/i);
});

test("analysis retry and report accept caller-owned request IDs", () => {
  assert.match(sessions, /retryPracticeAnalysis\(sessionId:\s*string,\s*requestId:\s*string\)/);
  assert.match(sessions, /const body:\s*RetryAnalysisRequest\s*=\s*\{\s*operation:\s*"retry",\s*requestId\s*\}/);
  assert.match(sessions, /createPracticeReport\(sessionId:\s*string,\s*requestId:\s*string\)/);
  assert.match(sessions, /const body:\s*CreateReportRequest\s*=\s*\{\s*requestId\s*\}/);
});

test("logical attempts reuse identity until settled and business retries get a new identity", async () => {
  const { createLogicalAttemptRegistry } = await importTypeScriptModule(
    "apps", "web", "src", "features", "practice", "logical-attempt.ts",
  );
  const ids = ["request-a", "request-b"];
  const registry = createLogicalAttemptRegistry(() => ids.shift());

  const first = registry.acquire("reply:session-1", () => ({ text: "same answer" }));
  const transportRetry = registry.acquire("reply:session-1", () => ({ text: "ignored" }));
  assert.deepEqual(transportRetry, first);
  assert.equal(first.requestId, "request-a");
  assert.equal(registry.settle("reply:session-1", "another-request"), false);
  assert.deepEqual(registry.peek("reply:session-1"), first);

  assert.equal(registry.settle("reply:session-1", first.requestId), true);
  const businessRetry = registry.acquire("reply:session-1", () => ({ text: "same answer" }));
  assert.equal(businessRetry.requestId, "request-b");
  assert.notEqual(businessRetry.requestId, first.requestId);
});

test("all generic transport and JSON parse failures attempt persisted reconciliation", async () => {
  const { reconcilePersistedMutation } = await importTypeScriptModule(
    "apps", "web", "src", "features", "practice", "logical-attempt.ts",
  );
  const failures = [
    new TypeError("response lost"),
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    new SyntaxError("Unexpected end of JSON input"),
  ];
  const reconciled = [];

  for (const failure of failures) {
    const result = await reconcilePersistedMutation(
      "session-1",
      failure,
      async (sessionId) => ({ id: sessionId, question: "Q2" }),
      (session) => reconciled.push(session),
    );
    assert.equal(result, true);
  }

  assert.equal(reconciled.length, failures.length);
  assert.ok(reconciled.every((session) => session.question === "Q2"));
  assert.doesNotMatch(sessions, /response\.json\(\)\.catch\(\(\)\s*=>\s*null\)/);
  assert.doesNotMatch(flow, /if\s*\(\s*!\(reason instanceof ApiClientError\)[\s\S]*?\)\s*return;/);
});

test("begin preserves upload intent, storage path, session, and create request identity until reconciliation", () => {
  assert.match(flow, /logicalAttempts\.acquire\("begin"/);
  assert.doesNotMatch(flow, /createPracticeSession\(\{\s*requestId:\s*crypto\.randomUUID\(\)/);
  assert.match(flow, /uploadIntentId[\s\S]*storagePath[\s\S]*sessionId[\s\S]*requestId/);
});

test("start restart analysis retry and report transport retries reuse their logical attempt IDs", () => {
  assert.doesNotMatch(flow, /mutatePracticeTurn\(target\.id,\s*\{\s*operation:\s*kind,\s*requestId:\s*crypto\.randomUUID\(\)/);
  assert.match(flow, /logicalAttempts\.acquire/);
  assert.match(flow, /retryPracticeAnalysis\(active\.id,\s*[A-Za-z0-9_.]+requestId\)/);
  assert.match(flow, /createPracticeReport\(active\.id,\s*[A-Za-z0-9_.]+requestId\)/);
});

test("retry_reply uses a new business-attempt ID and reuses it for transport reconciliation", () => {
  assert.match(flow, /retryReply[\s\S]*logicalAttempts\.acquire/);
  assert.doesNotMatch(
    flow,
    /retryReply[\s\S]*?mutatePracticeTurn\([\s\S]*?requestId:\s*crypto\.randomUUID\(\)/,
    "the retry_reply request ID must be created once for the business attempt, not inside each POST",
  );
});

test("the optional stale-turn RPC argument is appended to the stable claim order", () => {
  const repository = read(
    "apps", "web", "src", "server", "repositories", "supabase-coach-session-repository.ts",
  );
  assert.match(
    repository,
    /p_retry_actor_turn_id:[\s\S]*p_lease_token:[\s\S]*p_lease_seconds:[\s\S]*p_expected_ai_turn_id:/,
  );
});
