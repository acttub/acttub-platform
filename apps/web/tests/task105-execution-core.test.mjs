import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyOwnerSessionScope } from "../src/server/session-visibility.js";
import { createAiPipelineExecutionCore, fingerprintAgentClaim, buildAgentClaimPayload, interviewProgress, assertExpectedInterviewProgress, assertTerminalAtConversationLimit, sanitizePublicAiPipelineAggregate } from "../src/server/ai-pipeline-execution-core.js";

class FakeQuery {
  constructor(calls = []) { this.calls = calls; }
  eq(key, value) { this.calls.push(["eq", key, value]); return this; }
  is(key, value) { this.calls.push(["is", key, value]); return this; }
}

class FakeRowQuery {
  constructor(rows) { this.rows = rows; }
  eq(key, value) { this.rows = this.rows.filter((row) => row[key] === value); return this; }
  is(key, value) { this.rows = this.rows.filter((row) => row[key] === value); return this; }
  maybeSingle() {
    assert.ok(this.rows.length <= 1, "owner scope must resolve at most one row");
    return { data: this.rows[0] ?? null, error: null };
  }
}

test("owner session scope helper applies public and deletion filters", () => {
  const publicQuery = new FakeQuery();
  applyOwnerSessionScope(publicQuery, { sessionId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", visibility: "public" });
  assert.deepEqual(publicQuery.calls, [["eq", "id", "00000000-0000-4000-8000-000000000001"], ["eq", "user_id", "00000000-0000-4000-8000-000000000002"], ["is", "hidden_at", null], ["eq", "deletion_status", "active"]]);
  const deletionQuery = new FakeQuery();
  applyOwnerSessionScope(deletionQuery, { sessionId: "00000000-0000-4000-8000-000000000003", userId: "00000000-0000-4000-8000-000000000004", visibility: "deletion" });
  assert.deepEqual(deletionQuery.calls, [["eq", "id", "00000000-0000-4000-8000-000000000003"], ["eq", "user_id", "00000000-0000-4000-8000-000000000004"]]);
  assert.throws(() => applyOwnerSessionScope(new FakeQuery(), { sessionId: "s", userId: "u", visibility: "internal" }), /invalid_visibility/);
});

test("owner session visibility scopes enforce executable row semantics", () => {
  const userId = "00000000-0000-4000-8000-000000000002";
  const rows = [
    { id: "active", user_id: userId, hidden_at: null, deletion_status: "active" },
    { id: "hidden", user_id: userId, hidden_at: "2026-01-01T00:00:00.000Z", deletion_status: "active" },
    { id: "deleting", user_id: userId, hidden_at: null, deletion_status: "deleting" },
    { id: "other-owner", user_id: "00000000-0000-4000-8000-000000000099", hidden_at: null, deletion_status: "active" },
  ];
  const read = (sessionId, visibility) => applyOwnerSessionScope(
    new FakeRowQuery(structuredClone(rows)),
    { sessionId, userId, visibility },
  ).maybeSingle().data;

  assert.equal(read("active", "public")?.id, "active");
  assert.equal(read("hidden", "public"), null);
  assert.equal(read("deleting", "public"), null);
  assert.equal(read("hidden", "deletion")?.id, "hidden");
  assert.equal(read("deleting", "deletion")?.id, "deleting");
  assert.equal(read("other-owner", "deletion"), null);

  const activeMutation = applyOwnerSessionScope(
    new FakeRowQuery(structuredClone(rows)),
    { sessionId: "active", userId, visibility: "deletion" },
  ).eq("deletion_status", "active").maybeSingle().data;
  const deletingMutation = applyOwnerSessionScope(
    new FakeRowQuery(structuredClone(rows)),
    { sessionId: "deleting", userId, visibility: "deletion" },
  ).eq("deletion_status", "active").maybeSingle().data;
  assert.equal(activeMutation?.id, "active");
  assert.equal(deletingMutation, null);
});

test("public reads, deletion reads, and visibility mutation stay bound to their scopes", () => {
  const coachRepository = readFileSync(new URL("../src/server/repositories/supabase-coach-session-repository.ts", import.meta.url), "utf8");
  const pipelineRepository = readFileSync(new URL("../src/server/repositories/supabase-ai-pipeline-repository.ts", import.meta.url), "utf8");
  const coachService = readFileSync(new URL("../src/server/services/coach-session-service.ts", import.meta.url), "utf8");
  const pipelineService = readFileSync(new URL("../src/server/ai-pipeline-service-core.js", import.meta.url), "utf8");

  assert.match(pipelineRepository, /findPipelineSessionForOwner[\s\S]*?visibility:"public"/);
  assert.match(coachRepository, /hydrateSession[\s\S]{0,600}visibility: includeHidden \? "deletion" : "public"/);
  assert.match(coachRepository, /updateVisibility[\s\S]{0,900}visibility: "deletion"[\s\S]{0,120}\.eq\("deletion_status", "active"\)/);
  assert.match(coachService, /createSignedVideoUrl[\s\S]{0,500}readSessionForOwner\(sessionId, userId\)/);
  assert.match(coachService, /getSessionIncludingHidden[\s\S]{0,200}readSessionForDeletion\(sessionId, userId\)/);
  assert.match(pipelineService, /async getSession\(sessionId, userId\)[\s\S]{0,120}aggregate\(sessionId, userId\)/);
  assert.match(pipelineService, /async getReport\(sessionId, userId\)[\s\S]{0,120}aggregate\(sessionId, userId\)/);
  assert.match(pipelineService, /async deleteSession\(sessionId, userId, requestId\)[\s\S]{0,500}getSessionIncludingHidden\(sessionId, userId\)/);
});

test("execution core replays completed claims and only invokes the provider for owned running runs", async () => {
  let providerCount = 0;
  let committed = false;
  let firstClaim = true;
  const sharedRun = { id: "00000000-0000-4000-8000-000000000010", status: "running", safeErrorCode: null };
  const core = createAiPipelineExecutionCore({
    claimRun: async () => {
      if (firstClaim) {
        firstClaim = false;
        return { owned: true, run: { ...sharedRun } };
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { owned: false, run: { ...sharedRun } };
    },
    readRun: async () => ({ owned: false, run: { ...sharedRun, status: committed ? "completed" : "running", safeErrorCode: committed ? null : null } }),
    waitAttempts: 1,
    waitDelayMs: 0,
  });
  const invoke = async () => { providerCount += 1; return { value: providerCount }; };
  const persist = async (result) => { committed = true; return result; };
  const replay = (run) => run.status === "completed" ? { value: 1 } : { value: 0 };
  const recover = async () => null;
  const [first, second] = await Promise.all([
    core.run({ invoke, persist, replay, recover, providerFailure: async (error) => { throw error; }, persistenceFailure: async (error) => { throw error; } }),
    core.run({ invoke, persist, replay, recover, providerFailure: async (error) => { throw error; }, persistenceFailure: async (error) => { throw error; } }),
  ]);
  assert.equal(providerCount, 1);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
});

test("execution core recovers exact payload on persistence failure and fails closed when recovery is absent", async () => {
  let providerCount = 0;
  const run = { id: "00000000-0000-4000-8000-000000000011", status: "running", safeErrorCode: null };
  const core = createAiPipelineExecutionCore({
    claimRun: async () => ({ owned: true, run }),
    readRun: async () => ({ owned: true, run: { ...run, status: "completed" } }),
  });
  const payload = { ok: true };
  const persisted = await core.run({
    invoke: async () => { providerCount += 1; return payload; },
    persist: async () => { throw new Error("commit-failed"); },
    replay: (value) => value,
    recover: async () => payload,
    providerFailure: async (error) => { throw error; },
    persistenceFailure: async (error) => { throw error; },
  });
  assert.equal(providerCount, 1);
  assert.deepEqual(persisted, payload);
  await assert.rejects(core.run({
    invoke: async () => payload,
    persist: async () => { throw new Error("commit-failed"); },
    replay: (value) => value,
    recover: async () => null,
    providerFailure: async (error) => { throw error; },
    persistenceFailure: async (error) => { throw error; },
  }), /commit-failed/);
});

test("agent claim fingerprints bind answer and both expected counts", () => {
  const base = { schemaVersion: "agent-turn.v1", sessionId: "00000000-0000-4000-8000-000000000001", command: "answer", requestId: "00000000-0000-4000-8000-000000000002", answer: "a", observationId: null, expectedSubstantiveAnswerCount: 2, expectedTotalConversationCount: 3 };
  const digest = fingerprintAgentClaim(buildAgentClaimPayload(base));
  for (const changed of [{ ...base, answer: "b" }, { ...base, expectedSubstantiveAnswerCount: 1 }, { ...base, expectedTotalConversationCount: 4 }]) {
    assert.notEqual(fingerprintAgentClaim(buildAgentClaimPayload(changed)), digest);
  }
});

test("non-owned running claims poll a bounded number of times and never invoke", async () => {
  let reads = 0;
  let invokes = 0;
  const run = { id: "00000000-0000-4000-8000-000000000020", status: "running", safeErrorCode: null };
  const core = createAiPipelineExecutionCore({ claimRun: async () => ({ owned: false, run }), readRun: async () => { reads += 1; return { owned: false, run }; }, sleep: async () => {}, waitAttempts: 2, waitDelayMs: 1 });
  await assert.rejects(core.run({ invoke: async () => { invokes += 1; return null; }, persist: async () => {}, replay: () => null, recover: async () => null }), /AI_RUN_ALREADY_CLAIMED/);
  assert.equal(reads, 3);
  assert.equal(invokes, 0);
});

test("non-owned pending claims also poll a bounded number of times and never invoke", async () => {
  let reads = 0;
  let invokes = 0;
  const run = { id: "pending-run", status: "pending", safeErrorCode: null };
  const core = createAiPipelineExecutionCore({ claimRun: async () => ({ owned: false, run }), readRun: async () => { reads += 1; return { owned: false, run }; }, sleep: async () => {}, waitAttempts: 1, waitDelayMs: 1 });
  await assert.rejects(core.run({ invoke: async () => { invokes += 1; }, persist: async () => {}, replay: () => null, recover: async () => null }), /AI_RUN_ALREADY_CLAIMED/);
  assert.equal(reads, 2);
  assert.equal(invokes, 0);
});

test("initial non-owned failed claim preserves its exact persisted safe code", async () => {
  const core = createAiPipelineExecutionCore({ claimRun: async () => ({ owned: false, run: { id: "failed", status: "failed", safeErrorCode: "AI_INVALID_RESPONSE" } }), readRun: async () => assert.fail("read") });
  await assert.rejects(core.run({ invoke: async () => assert.fail("invoke"), persist: async () => assert.fail("persist"), replay: async () => assert.fail("replay") }), (error) => error.code === "AI_INVALID_RESPONSE");
});

test("async replay rejection is awaited and routed through recovery", async () => {
  let recovered = 0;
  const core = createAiPipelineExecutionCore({ claimRun: async () => ({ owned: false, run: { id: "done", status: "completed" } }), readRun: async () => assert.fail("read") });
  const value = await core.run({
    invoke: async () => assert.fail("invoke"),
    persist: async () => assert.fail("persist"),
    replay: async () => { throw new Error("async-replay-failed"); },
    recover: async (error) => { recovered += 1; assert.match(error.message, /async-replay-failed/); return { recovered: true }; },
  });
  assert.deepEqual(value, { recovered: true });
  assert.equal(recovered, 1);
});

test("non-owned poll read failure uses safe persistence recovery", async () => {
  let failures=0;
  const core=createAiPipelineExecutionCore({claimRun:async()=>({owned:false,run:{id:"r",status:"running"}}),readRun:async()=>{throw new Error("read")}});
  await assert.rejects(core.run({invoke:async()=>assert.fail("invoke"),persist:async()=>{},replay:()=>assert.fail("replay"),persistenceFailure:async()=>{failures+=1;throw new Error("safe")}}),/safe/);
  assert.equal(failures,1);
});

test("owned persistence never returns provider output without an observed exact commit", async () => {
  for (const readRun of [async () => null, async () => ({ owned: false, run: { id: "run", status: "running" } })]) {
    let failed = 0;
    const core = createAiPipelineExecutionCore({ claimRun: async () => ({ owned: true, run: { id: "run", status: "running" } }), readRun });
    await assert.rejects(core.run({ invoke: async () => ({ unsafe: "provider-only" }), persist: async () => {}, replay: () => ({ committed: true }), recover: async () => null, persistenceFailure: async (error) => { failed += 1; throw error; } }), /AI_RUN_COMMIT_NOT_OBSERVED/);
    assert.equal(failed, 1);
  }
});

test("recovery callback failure is routed through the safe persistence failure path", async () => {
  let persistenceFailureCount = 0;
  const core = createAiPipelineExecutionCore({
    claimRun: async () => ({ owned: true, run: { id: "run", status: "running" } }),
    readRun: async () => { throw new Error("reload-failed"); },
  });
  await assert.rejects(core.run({
    invoke: async () => ({ unsafe: "provider-only" }),
    persist: async () => {},
    replay: () => ({ committed: true }),
    recover: async () => { throw new Error("recovery-reload-failed"); },
    persistenceFailure: async (error) => {
      persistenceFailureCount += 1;
      assert.match(error.message, /recovery-reload-failed/);
      throw new Error("safe-persistence-failure");
    },
  }), /safe-persistence-failure/);
  assert.equal(persistenceFailureCount, 1);
});

test("interview progress helpers enforce exact substantive and reportable counts", () => {
  const transcript = [
    { role: "actor", kind: "answer" },
    { role: "actor", kind: "unknown" },
    { role: "actor", kind: "actor_correction" },
    { role: "agent", kind: "question" },
  ];
  const progress = interviewProgress(transcript);
  assert.equal(progress.substantiveAnswerCount, 1);
  assert.equal(progress.totalReportableActorCount, 2);
  assert.equal(progress.unknownCount, 1);
  assert.doesNotThrow(() => assertExpectedInterviewProgress({ actual: progress, expectedSubstantiveAnswerCount: 1, expectedTotalConversationCount: 2 }));
  assert.throws(() => assertExpectedInterviewProgress({ actual: progress, expectedSubstantiveAnswerCount: 2, expectedTotalConversationCount: 2 }), /invalid_progress/);
  assert.doesNotThrow(() => assertTerminalAtConversationLimit({ actual: { ...progress, totalReportableActorCount: 9 } }));
  assert.throws(() => assertTerminalAtConversationLimit({ actual: { ...progress, totalReportableActorCount: 10 }, done: false, completionReason: "manual_stop_report_ready" }), /nonterminal_tenth_turn/);
  assert.doesNotThrow(() => assertTerminalAtConversationLimit({ actual: { ...progress, totalReportableActorCount: 10 }, done: true, reportReady: true, completionReason: "hard_limit_report_ready" }));
  assert.doesNotThrow(() => assertTerminalAtConversationLimit({ actual: { ...progress, totalReportableActorCount: 10 }, done: true, reportReady: false, completionReason: "insufficient_interview_evidence" }));
});

test("public sanitizer strips internal run fields recursively", () => {
  const input = {
    sessionId: "s",
    summaryRun: { id: "r1", requestPayloadFingerprint: "abc", responsePayload: { done: true }, updatedAt: "now", safeErrorCode: null },
    runs: [{ id: "r2", requestPayloadFingerprint: "def", responsePayload: { done: false }, updatedAt: "later", stage: "agent" }],
  };
  const output = sanitizePublicAiPipelineAggregate(input);
  assert.equal(output.summaryRun.requestPayloadFingerprint, undefined);
  assert.equal(output.summaryRun.responsePayload, undefined);
  assert.equal(output.summaryRun.updatedAt, undefined);
  assert.equal(output.runs[0].requestPayloadFingerprint, undefined);
  assert.equal(output.runs[0].responsePayload, undefined);
  assert.equal(output.runs[0].updatedAt, undefined);
  assert.deepEqual(output, {
    sessionId: "s",
    summaryRun: { id: "r1", safeErrorCode: null },
    runs: [{ id: "r2", stage: "agent" }],
  });
});
