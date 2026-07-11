import assert from "node:assert/strict";
import test from "node:test";
import { createAiPipelineService } from "../src/server/ai-pipeline-service-core.js";
import { fingerprintJson } from "../src/server/ai-pipeline-fingerprint.js";

class FakePersistenceError extends Error {
  constructor(field) { super(field); this.field = field; }
}
class FakeAiServiceError extends Error {
  constructor(stage, code, status, retryable) { super(code); this.stage = stage; this.code = code; this.status = status; this.retryable = retryable; }
}

const loadServiceFactory = async () => createAiPipelineService;

const ids = {
  session: "00000000-0000-4000-8000-000000000101",
  user: "00000000-0000-4000-8000-000000000102",
  request: "00000000-0000-4000-8000-000000000103",
  summaryRun: "00000000-0000-4000-8000-000000000104",
  take: "00000000-0000-4000-8000-000000000105",
};

const baseSession = () => ({
  sessionId: ids.session, userId: ids.user, pipelineVersion: "ai-pipeline.v1",
  requiredConsentVersionSnapshot: "v1", aiProcessingConsentVersionSnapshot: "v1",
  interviewStatus: "active", completionReason: null, substantiveAnswerCount: 0,
  reportEvidenceObservationIds: [], reportEvidenceAnswerTurnIds: [],
  sceneContext: { genre: "drama", situation: "scene", characterContext: "actor", subtext: null },
  take: { id: ids.take, storageBucket: "practice-videos", storagePath: "u/s/video.mp4", durationMs: 1000, mediaMetadataVersion: "iso-bmff-duration.v1" },
  summary: { sourceRunId: ids.summaryRun, normalizedSummary: { schemaVersion: "scene-summary.v1", subtextStatus: "not_provided", observation: { timeline: "t", dialogue: "d", tempo: "t", pitch: "p", movement: "m", expression: "e", emotion: "e", extra: [] }, summary: "s", intentAlignment: null, keyMoment: null, keyDimension: null, anomalies: [] } },
  observations: [], corrections: [], transcript: [], runs: [], report: null,
});

test("production service seam deduplicates concurrent exact addTurn and replays persisted IDs", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const session = baseSession();
  session.observations.push({ id: "00000000-0000-4000-8000-000000000118", sourceRunId: ids.summaryRun, confirmationState: "accepted", blockedForQuestioning: false, priority: 1, startMs: 0, endMs: 1, text: "evidence", dimension: "voice", severity: "mid" });
  const claims = new Map();
  let providerCalls = 0;
  let appendCalls = 0;
  const repository = {
    async findPipelineSessionForOwner() { return structuredClone(session); },
    async claimRun(input) {
      const previous = claims.get(input.idempotencyKey);
      if (previous) {
        if (previous.requestPayloadFingerprint !== input.requestPayloadFingerprint) { const error = new Error("conflict"); error.field = "request_payload_conflict"; throw error; }
        return { owned: false, run: structuredClone(previous) };
      }
      const run = { id: input.runId, sessionId: input.sessionId, userId: input.userId, stage: input.stage, status: "running", idempotencyKey: input.idempotencyKey, attempt: 1, maxAttempts: input.maxAttempts, requestSchemaVersion: input.requestSchemaVersion, responseSchemaVersion: null, requestPayloadFingerprint: input.requestPayloadFingerprint, responsePayload: null, model: input.model, promptVersion: input.promptVersion, safeErrorCode: null, retryable: false, startedAt: "2026-01-01T00:00:00Z", completedAt: null, updatedAt: "2026-01-01T00:00:00Z" };
      claims.set(input.idempotencyKey, run); session.runs.push(run); return { owned: true, run: structuredClone(run) };
    },
    async appendPipelineTurn(input) {
      appendCalls += 1;
      session.transcript.push(input.actorTurn, input.agentTurn);
      session.substantiveAnswerCount = 1;
      const run = session.runs.find((item) => item.id === input.agentRunId);
      Object.assign(run, { status: "completed", responseSchemaVersion: "agent-turn.v1", responsePayload: structuredClone(input.responsePayload), model: input.model, promptVersion: input.promptVersion, completedAt: "2026-01-01T00:00:01Z" });
      claims.set(run.idempotencyKey, run);
    },
    async failRun() { throw new Error("unexpected failRun"); },
  };
  const deps = {
    repository,
    createAiTransport: () => ({ agent: async () => { providerCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { action: "ask_followup", utterance: "next", evidence: { observationIds: [] }, reportEvidence: { observationIds: [], answerTurnIds: [] }, done: false, completionReason: null, reportReady: false, model: "agent-model", promptVersion: "acting-agent.prompt.v2" }; } }),
    loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }),
  };
  const service = createAiPipelineService(deps);
  const body = { answer: "answer", requestId: ids.request, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 0 };
  const [left, right] = await Promise.all([service.addTurn(ids.session, ids.user, body), service.addTurn(ids.session, ids.user, body)]);
  assert.equal(providerCalls, 1);
  assert.equal(appendCalls, 1);
  assert.deepEqual(left, right);
  assert.equal(left.response, undefined);
  assert.equal(left.actorTurn.id, session.transcript[0].id);
  assert.equal(left.agentTurn.id, session.transcript[1].id);
});

test("provider failures preserve timeout unavailable invalid and internal safe codes", async () => {
  const createAiPipelineService = await loadServiceFactory();
  for (const [error, expectedCode, retryable] of [
    [new FakeAiServiceError("agent", "TIMEOUT", null, true), "AI_TIMEOUT", true],
    [new FakeAiServiceError("agent", "NETWORK_ERROR", null, true), "AI_UNAVAILABLE", true],
    [new FakeAiServiceError("agent", "HTTP_ERROR", 500, true), "AI_UNAVAILABLE", true],
    [new FakeAiServiceError("agent", "HTTP_ERROR", 400, false), "AI_INTERNAL", false],
    [new FakeAiServiceError("agent", "INVALID_RESPONSE", 200, false), "AI_INVALID_RESPONSE", false],
    [new Error("internal"), "AI_INTERNAL", false],
  ]) {
    const session = baseSession();
    let failed = null;
    const repository = {
      async findPipelineSessionForOwner() { return structuredClone(session); },
      async claimRun(input) { return { owned: true, run: { id: input.runId, status: "running", safeErrorCode: null } }; },
      async failRun(input) { failed = input; },
    };
    const service = createAiPipelineService({ repository, createAiTransport: () => ({ agent: async () => { throw error; } }), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
    await assert.rejects(service.addTurn(ids.session, ids.user, { answer: "answer", requestId: ids.request, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 0 }), (caught) => caught?.code === expectedCode);
    assert.equal(failed.safeErrorCode, expectedCode);
    assert.equal(failed.retryable, retryable);
  }
});

test("early invalid completion count is AI_INVALID_RESPONSE and never appends", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const session=baseSession(); let appendCalls=0; const failures=[];
  const repository={
    async findPipelineSessionForOwner(){return structuredClone(session)},
    async claimRun(input){const run={id:input.runId,stage:"agent",status:"running",safeErrorCode:null};session.runs=[run];return{owned:true,run}},
    async appendPipelineTurn(){appendCalls+=1},
    async failRun(input){failures.push(input);session.runs=[{...session.runs[0],status:"failed",safeErrorCode:input.safeErrorCode}]},
  };
  const service=createAiPipelineService({repository,createAiTransport:()=>({agent:async()=>({action:"close",utterance:"done",evidence:{observationIds:[]},reportEvidence:{observationIds:[],answerTurnIds:[]},done:true,completionReason:"insufficient_interview_evidence",reportReady:false,model:"agent-model",promptVersion:"acting-agent.prompt.v2"})}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({}),coachSessionService:{},createSupabaseAdminClient:()=>null,getAppConfig:()=>({video:{bucket:"practice-videos"}})});
  await assert.rejects(service.addTurn(ids.session,ids.user,{answer:"answer",requestId:ids.request,expectedSubstantiveAnswerCount:0,expectedTotalConversationCount:0}),error=>error?.status===502&&error?.code==="AI_INVALID_RESPONSE");
  assert.equal(appendCalls,0); assert.equal(failures.length,1); assert.equal(failures[0].safeErrorCode,"AI_INVALID_RESPONSE"); assert.equal(failures[0].retryable,false);
});

test("production service freezes its API and snapshots caller-owned dependencies", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const session = baseSession();
  session.runs.push({ id: "00000000-0000-4000-8000-000000000130", stage: "agent", requestPayloadFingerprint: "secret", responsePayload: { done: false }, updatedAt: "internal" });
  const repository = { async findPipelineSessionForOwner() { return structuredClone(session); } };
  const deps = {
    repository,
    createAiTransport: () => ({}), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }),
  };
  const service = createAiPipelineService(deps);
  deps.repository = { async findPipelineSessionForOwner() { throw new Error("mutated caller dependency"); } };
  assert.equal(Object.isFrozen(service), true);
  const publicSession = await service.getSession(ids.session, ids.user);
  assert.equal(publicSession.sessionId, ids.session);
  assert.equal(publicSession.runs[0].requestPayloadFingerprint, undefined);
  assert.equal(publicSession.runs[0].responsePayload, undefined);
  assert.equal(publicSession.runs[0].updatedAt, undefined);
});

test("repeated start stop and resume replay stable completed command claims without provider calls", async () => {
  const createAiPipelineService = await loadServiceFactory();
  for (const command of ["start", "manual_stop", "resume"]) {
    const session = baseSession();
    session.observations.push({ id: "00000000-0000-4000-8000-000000000110", candidateId: "00000000-0000-4000-8000-000000000111", sourceRunId: ids.summaryRun, confirmationState: "accepted", blockedForQuestioning: false, priority: 1, startMs: 0, endMs: 100, text: "evidence", dimension: "voice", severity: "mid" });
    const responsePayload = { actorTurn: null, agentTurn: { id: "00000000-0000-4000-8000-000000000112", sequence: 0, role: "agent", kind: "question", content: "next", questionFocus: "ask_followup", groundingStartMs: null, groundingEndMs: null, sourceObservationIds: [], reportEvidenceSelected: false }, done: false, completionReason: null, reportReady: false, reportEvidence: { observationIds: [], answerTurnIds: [] } };
    const run = { id: "00000000-0000-4000-8000-000000000113", sessionId: ids.session, userId: ids.user, stage: "agent", status: "completed", idempotencyKey: `${command}:0:0`, attempt: 1, maxAttempts: 2, requestSchemaVersion: "agent-turn.v1", responseSchemaVersion: "agent-turn.v1", requestPayloadFingerprint: "a".repeat(64), responsePayload, model: "agent-model", promptVersion: "acting-agent.prompt.v2", safeErrorCode: null, retryable: false, startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", updatedAt: "2026-01-01T00:00:01Z" };
    session.runs.push(run);
    let providerCalls = 0;
    let fingerprint = null;
    const repository = {
      async findPipelineSessionForOwner() { return structuredClone(session); },
      async claimRun(input) { fingerprint ??= input.requestPayloadFingerprint; assert.equal(input.requestPayloadFingerprint, fingerprint); return { owned: false, run: structuredClone(run) }; },
    };
    const service = createAiPipelineService({ repository, createAiTransport: () => ({ agent: async () => { providerCalls += 1; throw new Error("provider must not run"); } }), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
    const invoke = command === "start" ? () => service.startInterview(ids.session, ids.user) : command === "manual_stop" ? () => service.stopInterview(ids.session, ids.user) : () => service.resumeInterview(ids.session, ids.user);
    const first = await invoke();
    const second = await invoke();
    assert.deepEqual(second, first);
    assert.equal(providerCalls, 0);
  }
});

test("persisted failed Agent safe codes map to their public HTTP boundary", async () => {
  const session = baseSession();
  session.observations.push({ id: "00000000-0000-4000-8000-000000000117", sourceRunId: ids.summaryRun, confirmationState: "accepted", blockedForQuestioning: false, priority: 1, startMs: 0, endMs: 1, text: "evidence", dimension: "voice", severity: "mid" });
  const run = { id: "00000000-0000-4000-8000-000000000119", stage: "agent", status: "failed", safeErrorCode: "AI_INVALID_RESPONSE" };
  let providerCalls = 0;
  const repository = {
    async findPipelineSessionForOwner() { return structuredClone(session); },
    async claimRun() { return { owned: false, run: structuredClone(run) }; },
    async completeInterview() {},
  };
  const service = createAiPipelineService({ repository, createAiTransport: () => ({ agent: async () => { providerCalls += 1; } }), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
  await assert.rejects(service.startInterview(ids.session, ids.user), (error) => error.status === 502 && error.code === "AI_INVALID_RESPONSE");
  assert.equal(providerCalls, 0);
});

test("authoritative stale substantive and total counts reject as 409 before provider without misclassified failRun", async () => {
  const createAiPipelineService = await loadServiceFactory();
  for (const mutation of [
    (session) => { session.substantiveAnswerCount = 1; },
    (session) => { session.transcript.push({ id: "00000000-0000-4000-8000-000000000120", sequence: 0, role: "actor", kind: "unknown", content: "unknown", questionFocus: null, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: [], reportEvidenceSelected: false }); },
  ]) {
    const initial = baseSession();
    const authoritative = baseSession();
    mutation(authoritative);
    let reads = 0;
    let providerCalls = 0;
    const failedRuns = [];
    let claimedRun;
    const repository = {
      async findPipelineSessionForOwner() { reads += 1; return structuredClone(reads === 1 ? initial : authoritative); },
      async claimRun(input) { claimedRun={ id: input.runId, stage:"agent", status:"running", safeErrorCode:null }; return { owned:true, run:structuredClone(claimedRun) }; },
      async failRun(input) { failedRuns.push(input); authoritative.runs=[{...claimedRun,status:"failed",safeErrorCode:input.safeErrorCode}]; },
    };
    const service = createAiPipelineService({ repository, createAiTransport: () => ({ agent: async () => { providerCalls += 1; throw new Error("provider must not run"); } }), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
    await assert.rejects(service.addTurn(ids.session, ids.user, { answer: "answer", requestId: ids.request, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 0 }), (error) => error?.status === 409 && error?.code === "STALE_INTERVIEW_PROGRESS");
    assert.equal(providerCalls, 0);
    assert.equal(failedRuns.length, 1);
    assert.equal(failedRuns[0].safeErrorCode, "AI_INTERNAL");
    assert.equal(failedRuns[0].retryable, false);
    assert.match(failedRuns[0].runId, /^[0-9a-f-]{36}$/i);
  }
});

test("stale progress recovers a lost failRun response only after observing the claimed run terminal", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const initial = baseSession();
  const authoritative = baseSession();
  authoritative.substantiveAnswerCount = 1;
  let claimedRun;
  let reads = 0;
  let failCalls = 0;
  let cleaned = false;
  const repository = {
    async findPipelineSessionForOwner() {
      reads += 1;
      const value = structuredClone(reads === 1 ? initial : authoritative);
      if (reads >= 3) value.runs = [{ ...claimedRun, status: cleaned ? "failed" : "running", safeErrorCode: cleaned ? "AI_INTERNAL" : null }];
      return value;
    },
    async claimRun(input) {
      claimedRun = { id: input.runId, stage: "agent", status: "running", safeErrorCode: null };
      return { owned: true, run: structuredClone(claimedRun) };
    },
    async failRun(input) {
      failCalls += 1;
      assert.equal(input.runId, claimedRun.id);
      assert.equal(input.safeErrorCode, "AI_INTERNAL");
      assert.equal(input.retryable, false);
      if (failCalls === 1) throw new Error("precommit cleanup failure");
      cleaned = true;
    },
  };
  const service = createAiPipelineService({ repository, createAiTransport: () => ({ agent: async () => { throw new Error("provider must not run"); } }), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
  await assert.rejects(service.addTurn(ids.session, ids.user, { answer: "answer", requestId: ids.request, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 0 }), (error) => error?.status === 409 && error?.code === "STALE_INTERVIEW_PROGRESS");
  assert.equal(failCalls, 2);
});

test("stale progress fails closed after repeated cleanup failures leave the claimed run running", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const initial = baseSession(), authoritative = baseSession();
  authoritative.substantiveAnswerCount = 1;
  let reads = 0, failCalls = 0, claimedRun;
  const repository = {
    async findPipelineSessionForOwner() { reads += 1; const value=structuredClone(reads===1?initial:authoritative); if(reads>=3)value.runs=[{...claimedRun,status:"running"}]; return value; },
    async claimRun(input) { claimedRun={id:input.runId,stage:"agent",status:"running",safeErrorCode:null}; return {owned:true,run:structuredClone(claimedRun)}; },
    async failRun() { failCalls += 1; throw new Error("cleanup unavailable"); },
  };
  const service=createAiPipelineService({repository,createAiTransport:()=>({agent:async()=>{throw new Error("provider must not run")}}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({}),coachSessionService:{},createSupabaseAdminClient:()=>null,getAppConfig:()=>({video:{bucket:"practice-videos"}})});
  await assert.rejects(service.addTurn(ids.session,ids.user,{answer:"answer",requestId:ids.request,expectedSubstantiveAnswerCount:0,expectedTotalConversationCount:0}),error=>error?.status===503&&error?.code==="TURN_PERSISTENCE_FAILED");
  assert.equal(failCalls,2);
});

test("same request key with changed answer or either expected count rejects fingerprint conflict before provider", async () => {
  const createAiPipelineService = await loadServiceFactory();
  for (const changed of [
    { answer: "changed", requestId: ids.request, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 0 },
    { answer: "answer", requestId: ids.request, expectedSubstantiveAnswerCount: 1, expectedTotalConversationCount: 1 },
    { answer: "answer", requestId: ids.request, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 1 },
  ]) {
    const session = baseSession();
    const expectedFingerprint = fingerprintJson({ schemaVersion: "agent-turn.v1", sessionId: ids.session, command: "answer", requestId: ids.request, answer: "answer", observationId: null, expectedSubstantiveAnswerCount: 0, expectedTotalConversationCount: 0 });
    let providerCalls = 0;
    const repository = {
      async findPipelineSessionForOwner() { return structuredClone(session); },
      async claimRun(input) { if (input.requestPayloadFingerprint !== expectedFingerprint) throw new FakePersistenceError("request_payload_conflict"); throw new Error("unexpected exact claim"); },
    };
    const service = createAiPipelineService({ repository, createAiTransport: () => ({ agent: async () => { providerCalls += 1; } }), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
    await assert.rejects(service.addTurn(ids.session, ids.user, changed), (error) => error?.status === 409 && error?.code === "REQUEST_PAYLOAD_CONFLICT");
    assert.equal(providerCalls, 0);
  }
});

test("deletion retry preserves hidden deleting-session lookup and does not delete storage twice", async () => {
  const createAiPipelineService = await loadServiceFactory();
  let attempt = null;
  let removeCalls = 0;
  let completeCalls = 0;
  const repository = {
    async findDeletionAttempt() { return attempt ? structuredClone(attempt) : null; },
    async beginDelete({ sessionId, requestId }) { attempt = attempt ? { ...attempt, status: "running" } : { sessionId, requestId, status: "running", storageDeleted: false }; },
    async recordStorageDeleted() { attempt.storageDeleted = true; },
    async completeDelete() { completeCalls += 1; if (completeCalls === 1) throw new Error("rows failed"); attempt.status = "completed"; },
    async failDelete({ safeErrorCode }) { attempt.status = "failed"; attempt.safeErrorCode = safeErrorCode; },
  };
  const deps = {
    repository, createAiTransport: () => ({}), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}),
    coachSessionService: { async getSessionIncludingHidden() { return { take: { videoUrl: "supabase://practice-videos/u/s/video.mp4" } }; } },
    createSupabaseAdminClient: () => ({ storage: { from: () => ({ async remove() { removeCalls += 1; return { error: null }; }, async list() { return { error: null, data: [] }; } }) } }),
    getAppConfig: () => ({ video: { bucket: "practice-videos" } }),
  };
  const service = createAiPipelineService(deps);
  await assert.rejects(service.deleteSession(ids.session, ids.user, ids.request), (error) => error?.code === "DELETE_ROWS_FAILED");
  assert.equal(attempt.storageDeleted, true);
  assert.deepEqual(await service.deleteSession(ids.session, ids.user, ids.request), { requestId: ids.request, status: "completed" });
  assert.equal(removeCalls, 1);
  assert.equal(completeCalls, 2);
});

test("Report claim fingerprint is stable when persisted corrections arrive in different row order", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const fingerprints = [];
  for (const reverse of [false, true]) {
    const session = baseSession();
    session.interviewStatus = "completed";
    session.completionReason = "hard_limit_report_ready";
    session.runs.push({ id: idFor(140), stage: "agent", status: "completed", responseSchemaVersion: "agent-turn.v1", model: "agent-model", promptVersion: "acting-agent.prompt.v2", responsePayload: { actorTurn: null, agentTurn: { id: idFor(141) }, done: true, completionReason: "hard_limit_report_ready", reportReady: true, reportEvidence: { observationIds: [], answerTurnIds: [] } }, completedAt: "2026-01-01T00:00:00Z", attempt: 1 });
    const corrections = [
      { id: idFor(142), correctionByTurnId: idFor(144), correctsObservationId: idFor(146), segment: { startMs: 1, endMs: 2 }, text: "a" },
      { id: idFor(143), correctionByTurnId: idFor(145), correctsObservationId: idFor(147), segment: { startMs: 3, endMs: 4 }, text: "b" },
    ];
    session.corrections = reverse ? corrections.reverse() : corrections;
    const repository = { async findPipelineSessionForOwner() { return structuredClone(session); }, async claimRun(input) { fingerprints.push(input.requestPayloadFingerprint); throw new Error("captured"); } };
    const service = createAiPipelineService({ repository, createAiTransport: () => ({}), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }) });
    await assert.rejects(service.retryReport(ids.session, ids.user), /captured/);
  }
  assert.equal(fingerprints[0], fingerprints[1]);
});

function idFor(value) { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }

test("createSession recovers an exact committed Summary after persistence response loss and sanitizes output", async () => {
  const session=baseSession(); session.summary=null; session.runs=[]; let providerCalls=0,completeCalls=0;
  const repository={
    async findEligibleUpload(){return{sessionId:ids.session,storagePath:"u/s/video.mp4",requiredConsentVersionSnapshot:"v1",aiProcessingConsentVersionSnapshot:"v1"}},
    async createPipelineSession(){},
    async findPipelineSessionForOwner(){return structuredClone(session)},
    async claimRun(input){const run={id:input.runId,sessionId:ids.session,userId:ids.user,stage:"summary",status:"running",requestPayloadFingerprint:input.requestPayloadFingerprint,responsePayload:null,updatedAt:"internal"};session.runs=[run];return{owned:true,run:structuredClone(run)}},
    async completeSummaryRun(input){completeCalls+=1;session.summary={sourceRunId:input.runId,normalizedSummary:structuredClone(input.normalizedSummary)};session.runs=[{...session.runs[0],status:"completed",responseSchemaVersion:"summary-response.v1",model:input.model,promptVersion:input.promptVersion,responsePayload:{secret:true},updatedAt:"internal"}];throw new Error("commit response lost")},
    async failRun(){throw new Error("committed Summary must recover without failRun")},
  };
  const normalized=baseSession().summary.normalizedSummary;
  const service=createAiPipelineService({repository,createAiTransport:()=>({summary:async()=>{providerCalls+=1;return{normalizedSummary:normalized,observationCandidates:[],model:"summary-model",promptVersion:"acting-summary.prompt.v2"}}}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({requiredConsentVersion:"v1",aiProcessingConsentVersion:"v1"}),coachSessionService:{},createSupabaseAdminClient:()=>({storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"https://signed.invalid"},error:null})})}}),getAppConfig:()=>({video:{bucket:"practice-videos",signedUrlExpiresInSeconds:60}}),createSummaryNetworkError:()=>new Error("network")});
  const result=await service.createSession({sessionId:ids.session,uploadIntentId:"00000000-0000-4000-8000-000000000140",storagePath:"u/s/video.mp4",genre:"drama",situation:"scene",characterContext:"actor",subtext:null},ids.user);
  assert.equal(providerCalls,1); assert.equal(completeCalls,1); assert.equal(result.summaryRun.status,"completed");
  assert.equal(result.summaryRun.requestPayloadFingerprint,undefined); assert.equal(result.summaryRun.responsePayload,undefined); assert.equal(result.summaryRun.updatedAt,undefined);
  assert.equal(result.session.summary.sourceRunId,result.summaryRun.id);
});

test("retryReport observes a fresh running exact Report claim without invoking provider", async () => {
  const session=baseSession(); session.interviewStatus="completed"; session.completionReason="manual_stop_report_ready";
  const terminalId="00000000-0000-4000-8000-000000000150", reportId="00000000-0000-4000-8000-000000000151";
  const reportEvidence={observationIds:[],answerTurnIds:[]};
  session.runs.push({id:terminalId,stage:"agent",status:"completed",responseSchemaVersion:"agent-turn.v1",model:"agent-model",promptVersion:"acting-agent.prompt.v2",completedAt:"2026-01-01T00:00:00Z",attempt:1,responsePayload:{actorTurn:null,agentTurn:{id:"00000000-0000-4000-8000-000000000152",sequence:0,role:"agent",kind:"closing",content:"done",questionFocus:null,groundingStartMs:null,groundingEndMs:null,sourceObservationIds:[],reportEvidenceSelected:false},done:true,completionReason:"manual_stop_report_ready",reportReady:true,reportEvidence}});
  const running={id:reportId,stage:"report",status:"running",idempotencyKey:`report:${terminalId}`,attempt:1,maxAttempts:2,startedAt:new Date().toISOString(),safeErrorCode:null}; session.runs.push(running);
  let providerCalls=0,claimCalls=0;
  const repository={async findPipelineSessionForOwner(){return structuredClone(session)},async claimRun(){claimCalls+=1;return{owned:false,run:structuredClone(running)}}};
  const service=createAiPipelineService({repository,createAiTransport:()=>({report:async()=>{providerCalls+=1;throw new Error("provider must not run")}}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({}),coachSessionService:{},createSupabaseAdminClient:()=>null,getAppConfig:()=>({video:{bucket:"practice-videos"}})});
  await assert.rejects(service.retryReport(ids.session,ids.user),error=>error?.status===409);
  assert.equal(claimCalls,1); assert.equal(providerCalls,0);
});

test("createSession replays an exact completed Summary deeply equal with zero provider calls", async () => {
  const session=baseSession(); const run={id:ids.summaryRun,sessionId:ids.session,userId:ids.user,stage:"summary",status:"completed",responseSchemaVersion:"summary-response.v1",model:"summary-model",promptVersion:"acting-summary.prompt.v2",requestPayloadFingerprint:"secret",responsePayload:{secret:true},updatedAt:"internal"}; session.runs=[run];
  let providerCalls=0,claimCalls=0;
  const repository={async findEligibleUpload(){return{sessionId:ids.session,storagePath:"u/s/video.mp4",requiredConsentVersionSnapshot:"v1",aiProcessingConsentVersionSnapshot:"v1"}},async createPipelineSession(){},async findPipelineSessionForOwner(){return structuredClone(session)},async claimRun(){claimCalls+=1;return{owned:false,run:structuredClone(run)}},async failRun(){throw new Error("completed replay must not fail")}};
  const service=createAiPipelineService({repository,createAiTransport:()=>({summary:async()=>{providerCalls+=1;throw new Error("provider must not run")}}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({requiredConsentVersion:"v1",aiProcessingConsentVersion:"v1"}),coachSessionService:{},createSupabaseAdminClient:()=>null,getAppConfig:()=>({video:{bucket:"practice-videos"}}),createSummaryNetworkError:()=>new Error("network")});
  const body={sessionId:ids.session,uploadIntentId:"00000000-0000-4000-8000-000000000140",storagePath:"u/s/video.mp4",genre:"drama",situation:"scene",characterContext:"actor",subtext:null};
  const first=await service.createSession(body,ids.user),second=await service.createSession(body,ids.user);
  assert.deepEqual(second,first); assert.equal(claimCalls,2); assert.equal(providerCalls,0); assert.equal(first.summaryRun.requestPayloadFingerprint,undefined); assert.equal(first.summaryRun.responsePayload,undefined);
});

test("createSession owned Summary persists once and returns the exact committed aggregate", async () => {
  const session=baseSession(); session.summary=null; session.runs=[]; let providerCalls=0,completeCalls=0;
  const repository={async findEligibleUpload(){return{sessionId:ids.session,storagePath:"u/s/video.mp4",requiredConsentVersionSnapshot:"v1",aiProcessingConsentVersionSnapshot:"v1"}},async createPipelineSession(){},async findPipelineSessionForOwner(){return structuredClone(session)},async claimRun(input){const run={id:input.runId,stage:"summary",status:"running",safeErrorCode:null};session.runs=[run];return{owned:true,run:structuredClone(run)}},async completeSummaryRun(input){completeCalls+=1;session.summary={sourceRunId:input.runId,normalizedSummary:structuredClone(input.normalizedSummary)};session.runs=[{...session.runs[0],status:"completed",responseSchemaVersion:"summary-response.v1",model:input.model,promptVersion:input.promptVersion}]},async failRun(){throw new Error("unexpected fail")}};
  const service=createAiPipelineService({repository,createAiTransport:()=>({summary:async()=>{providerCalls+=1;return{normalizedSummary:baseSession().summary.normalizedSummary,observationCandidates:[],model:"summary-model",promptVersion:"acting-summary.prompt.v2"}}}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({requiredConsentVersion:"v1",aiProcessingConsentVersion:"v1"}),coachSessionService:{},createSupabaseAdminClient:()=>({storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"https://signed.invalid"},error:null})})}}),getAppConfig:()=>({video:{bucket:"practice-videos",signedUrlExpiresInSeconds:60}}),createSummaryNetworkError:()=>new Error("network")});
  const result=await service.createSession({sessionId:ids.session,uploadIntentId:"00000000-0000-4000-8000-000000000140",storagePath:"u/s/video.mp4",genre:"drama",situation:"scene",characterContext:"actor",subtext:null},ids.user);
  assert.equal(providerCalls,1);assert.equal(completeCalls,1);assert.equal(result.summaryRun.status,"completed");assert.equal(result.session.summary.sourceRunId,result.summaryRun.id);
});

test("createSession recovers when the first post-persist Summary reload fails", async () => {
  const session=baseSession();session.summary=null;session.runs=[];let reads=0,providerCalls=0,failCalls=0;
  const repository={async findEligibleUpload(){return{sessionId:ids.session,storagePath:"u/s/video.mp4",requiredConsentVersionSnapshot:"v1",aiProcessingConsentVersionSnapshot:"v1"}},async createPipelineSession(){},async findPipelineSessionForOwner(){reads+=1;if(reads===2)throw new Error("first reload unavailable");return structuredClone(session)},async claimRun(input){const run={id:input.runId,stage:"summary",status:"running",safeErrorCode:null};session.runs=[run];return{owned:true,run:structuredClone(run)}},async completeSummaryRun(input){session.summary={sourceRunId:input.runId,normalizedSummary:structuredClone(input.normalizedSummary)};session.runs=[{...session.runs[0],status:"completed",responseSchemaVersion:"summary-response.v1",model:input.model,promptVersion:input.promptVersion}]},async failRun(){failCalls+=1}};
  const service=createAiPipelineService({repository,createAiTransport:()=>({summary:async()=>{providerCalls+=1;return{normalizedSummary:baseSession().summary.normalizedSummary,observationCandidates:[],model:"summary-model",promptVersion:"acting-summary.prompt.v2"}}}),loadAiServiceConfig:()=>({}),requireCurrentAiProcessingConsent:async()=>{},getCurrentConsentVersions:async()=>({requiredConsentVersion:"v1",aiProcessingConsentVersion:"v1"}),coachSessionService:{},createSupabaseAdminClient:()=>({storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"https://signed.invalid"},error:null})})}}),getAppConfig:()=>({video:{bucket:"practice-videos",signedUrlExpiresInSeconds:60}}),createSummaryNetworkError:()=>new Error("network")});
  const result=await service.createSession({sessionId:ids.session,uploadIntentId:"00000000-0000-4000-8000-000000000140",storagePath:"u/s/video.mp4",genre:"drama",situation:"scene",characterContext:"actor",subtext:null},ids.user);
  assert.equal(reads,3);assert.equal(providerCalls,1);assert.equal(failCalls,0);assert.equal(result.summaryRun.status,"completed");
});
