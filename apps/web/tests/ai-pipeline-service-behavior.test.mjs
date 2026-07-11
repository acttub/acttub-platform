import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createAiPipelineExecutionCore, assertTerminalAtConversationLimit, interviewProgress, sanitizePublicAiPipelineAggregate } from "../src/server/ai-pipeline-execution-core.js";
import { fingerprintJson } from "../src/server/ai-pipeline-fingerprint.js";
import { countReportableActorTurns } from "../src/server/ai-pipeline-runtime-rules.js";

const loadServiceFactory = async () => {
  const sourcePath = path.resolve(import.meta.dirname, "../src/server/services/ai-pipeline-service.ts");
  const outputPath = path.resolve(import.meta.dirname, ".ai-pipeline-service.behavior.generated.mjs");
  const source = (await readFile(sourcePath, "utf8")).replace(/^import[^;]+;\s*$/gm, "");
  const preamble = `
const { createAiPipelineExecutionCore, assertTerminalAtConversationLimit, interviewProgress, sanitizePublicAiPipelineAggregate, fingerprintJson, countReportableActorTurns } = globalThis.__task105ServiceImports;
class AiServiceError extends Error { constructor(message, retryable = false) { super(message); this.retryable = retryable; } }
class AiPipelinePersistenceError extends Error { constructor(field) { super(field); this.field = field; } }
const repository = {}, createAiTransport = () => ({}), loadAiServiceConfig = () => ({}), requireCurrentAiProcessingConsent = async () => {}, getCurrentConsentVersions = async () => ({}), coachSessionService = {}, createSupabaseAdminClient = () => null, getAppConfig = () => ({ video: { bucket: "practice-videos" } });
`;
  globalThis.__task105ServiceImports = { createAiPipelineExecutionCore, assertTerminalAtConversationLimit, interviewProgress, sanitizePublicAiPipelineAggregate, fingerprintJson, countReportableActorTurns };
  const compiled = ts.transpileModule(preamble + source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  await writeFile(outputPath, compiled);
  try {
    return (await import(`${path.toNamespacedPath(outputPath)}?v=${Date.now()}`)).createAiPipelineService;
  } finally {
    await rm(outputPath, { force: true });
    delete globalThis.__task105ServiceImports;
  }
};

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
  summary: { sourceRunId: ids.summaryRun, normalizedSummary: { schemaVersion: "scene-summary.v1", summary: { synopsis: "x", actorObjective: "y", relationship: "z", turningPoint: "t", emotionalArc: "e" }, observation: { primary: "p", supporting: [] }, anomalies: [] } },
  observations: [], corrections: [], transcript: [], runs: [], report: null,
});

test("production service seam deduplicates concurrent exact addTurn and replays persisted IDs", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const session = baseSession();
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
  assert.equal(left.actorTurn.id, session.transcript[0].id);
  assert.equal(left.agentTurn.id, session.transcript[1].id);
});

test("production service freezes its API and snapshots caller-owned dependencies", async () => {
  const createAiPipelineService = await loadServiceFactory();
  const session = baseSession();
  const repository = { async findPipelineSessionForOwner() { return structuredClone(session); } };
  const deps = {
    repository,
    createAiTransport: () => ({}), loadAiServiceConfig: () => ({}), requireCurrentAiProcessingConsent: async () => {}, getCurrentConsentVersions: async () => ({}), coachSessionService: {}, createSupabaseAdminClient: () => null, getAppConfig: () => ({ video: { bucket: "practice-videos" } }),
  };
  const service = createAiPipelineService(deps);
  deps.repository = { async findPipelineSessionForOwner() { throw new Error("mutated caller dependency"); } };
  assert.equal(Object.isFrozen(service), true);
  assert.equal((await service.getSession(ids.session, ids.user)).sessionId, ids.session);
});
