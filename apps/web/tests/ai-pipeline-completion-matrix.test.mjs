import assert from "node:assert/strict";
import test from "node:test";

import { fingerprintJson } from "../src/server/ai-pipeline-fingerprint.js";
import { createAiPipelineService } from "../src/server/ai-pipeline-service-core.js";

const id = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const ids = {
  session: id(1),
  user: id(2),
  request: id(3),
  take: id(4),
  summaryRun: id(5),
  observation: id(6),
};

const normalizedSummary = {
  schemaVersion: "scene-summary.v1",
  subtextStatus: "not_provided",
  observation: {
    timeline: "timeline",
    dialogue: "dialogue",
    tempo: "tempo",
    pitch: "pitch",
    movement: "movement",
    expression: "expression",
    emotion: "emotion",
    extra: [],
  },
  summary: "summary",
  intentAlignment: null,
  keyMoment: null,
  keyDimension: null,
  anomalies: [],
};

const actorAnswer = (turnId, sequence, content = `answer-${sequence}`) => ({
  id: turnId,
  sequence,
  role: "actor",
  kind: "answer",
  content,
  questionFocus: null,
  groundingStartMs: null,
  groundingEndMs: null,
  sourceObservationIds: [],
  reportEvidenceSelected: false,
});

const acceptedObservation = () => ({
  id: ids.observation,
  candidateId: ids.observation,
  sourceRunId: ids.summaryRun,
  confirmationState: "accepted",
  blockedForQuestioning: false,
  priority: 1,
  startMs: 0,
  endMs: 1_000,
  text: "grounded evidence",
  dimension: "voice",
  severity: "mid",
});

const baseSession = () => ({
  sessionId: ids.session,
  userId: ids.user,
  pipelineVersion: "ai-pipeline.v1",
  requiredConsentVersionSnapshot: "terms.v1",
  aiProcessingConsentVersionSnapshot: "ai.v1",
  interviewStatus: "active",
  completionReason: null,
  substantiveAnswerCount: 0,
  reportEvidenceObservationIds: [],
  reportEvidenceAnswerTurnIds: [],
  sceneContext: {
    genre: "drama",
    situation: "scene",
    characterContext: "actor",
    subtext: null,
  },
  take: {
    id: ids.take,
    storageBucket: "practice-videos",
    storagePath: "owner/session/take.mp4",
    durationMs: 300_000,
    mediaMetadataVersion: "iso-bmff-duration.v1",
  },
  summary: {
    sourceRunId: ids.summaryRun,
    normalizedSummary: structuredClone(normalizedSummary),
  },
  observations: [],
  corrections: [],
  transcript: [],
  runs: [],
  optionalNote: null,
  report: null,
});

const reportSections = (answerTurnId) => {
  const grounded = {
    status: "confirmed",
    content: "grounded",
    observationEvidenceIds: [ids.observation],
    turnEvidenceIds: [answerTurnId],
    timestampRange: null,
  };
  return {
    oneLineSummary: grounded,
    primaryReviewPoint: {
      ...grounded,
      turnEvidenceIds: [],
      timestampRange: { startMs: 0, endMs: 1_000 },
    },
    confirmedEvidence: grounded,
    actorDiscovery: { ...grounded, observationEvidenceIds: [] },
    groundedEncouragement: { ...grounded, turnEvidenceIds: [] },
    nextPracticeStep: { ...grounded, observationEvidenceIds: [] },
  };
};

const dependencies = (repository, transport) => ({
  repository,
  createAiTransport: () => transport,
  loadAiServiceConfig: () => ({}),
  requireCurrentAiProcessingConsent: async () => {},
  getCurrentConsentVersions: async () => ({
    requiredConsentVersion: "terms.v1",
    aiProcessingConsentVersion: "ai.v1",
  }),
  coachSessionService: {},
  createSupabaseAdminClient: () => null,
  getAppConfig: () => ({ video: { bucket: "practice-videos" } }),
});

const makeCompletionHarness = ({ session, agentResponse }) => {
  const calls = {
    agentClaims: 0,
    agentProviders: 0,
    appends: 0,
    reportClaims: 0,
    reportProviders: 0,
    reportCompletes: 0,
  };

  const repository = {
    async findPipelineSessionForOwner() {
      return structuredClone(session);
    },
    async claimRun(input) {
      const counter = input.stage === "agent" ? "agentClaims" : "reportClaims";
      calls[counter] += 1;
      const run = {
        id: input.runId,
        stage: input.stage,
        status: "running",
        idempotencyKey: input.idempotencyKey,
        attempt: 1,
        maxAttempts: input.maxAttempts,
        safeErrorCode: null,
      };
      session.runs.push(run);
      return { owned: true, run: structuredClone(run) };
    },
    async appendPipelineTurn(input) {
      calls.appends += 1;
      if (input.actorTurn) session.transcript.push(structuredClone(input.actorTurn));
      session.transcript.push(structuredClone(input.agentTurn));
      session.substantiveAnswerCount = session.transcript.filter(
        (turn) => turn.role === "actor" && turn.kind === "answer",
      ).length;
      if (input.completionStatus) session.interviewStatus = input.completionStatus;
      session.completionReason = input.completionReason;
      session.reportEvidenceObservationIds = [...input.reportEvidence.observationIds];
      session.reportEvidenceAnswerTurnIds = [...input.reportEvidence.answerTurnIds];
      const run = session.runs.find((item) => item.id === input.agentRunId);
      Object.assign(run, {
        status: "completed",
        responseSchemaVersion: "agent-turn.v1",
        responsePayload: structuredClone(input.responsePayload),
        model: input.model,
        promptVersion: input.promptVersion,
        completedAt: "2026-01-01T00:00:00.000Z",
      });
    },
    async completeReportRun(input) {
      calls.reportCompletes += 1;
      const run = session.runs.find((item) => item.id === input.runId);
      const responsePayload = {
        schemaVersion: "report.v1",
        sessionId: ids.session,
        runId: input.runId,
        model: input.model,
        promptVersion: input.promptVersion,
        sections: structuredClone(input.report.sections),
      };
      Object.assign(run, {
        status: "completed",
        responseSchemaVersion: "report.v1",
        responsePayload,
        model: input.model,
        promptVersion: input.promptVersion,
        completedAt: "2026-01-01T00:00:01.000Z",
      });
      session.report = {
        sourceRunId: input.runId,
        schemaVersion: "report.v1",
        sections: structuredClone(input.report.sections),
      };
    },
    async findImmutableReport() {
      return structuredClone(session.report);
    },
    async failRun() {
      assert.fail("completion matrix must not fail a run");
    },
  };

  const transport = {
    async agent(request) {
      calls.agentProviders += 1;
      return agentResponse(request);
    },
    async report(request) {
      calls.reportProviders += 1;
      const answerTurnId = request.selectedEvidence.answerTurnIds[0];
      return {
        schemaVersion: "report.v1",
        sessionId: ids.session,
        runId: request.runId,
        model: "report-model",
        promptVersion: "acting-report.prompt.v2",
        sections: reportSections(answerTurnId),
      };
    },
  };

  return {
    calls,
    service: createAiPipelineService(dependencies(repository, transport)),
  };
};

test("all blocked observations terminate without claiming Agent or generating Report", async () => {
  const session = baseSession();
  session.observations = [
    { ...acceptedObservation(), id: id(10), confirmationState: "rejected", blockedForQuestioning: true },
    { ...acceptedObservation(), id: id(11), confirmationState: "unsure", blockedForQuestioning: true },
    { ...acceptedObservation(), id: id(12), confirmationState: "rejected", blockedForQuestioning: true },
  ];
  let completion = null;
  let claims = 0;
  let providers = 0;
  const repository = {
    async findPipelineSessionForOwner() {
      return structuredClone(session);
    },
    async completeInterview(input) {
      completion = structuredClone(input);
    },
    async claimRun() {
      claims += 1;
      assert.fail("blocked observations must not claim an AI run");
    },
  };
  const service = createAiPipelineService(
    dependencies(repository, {
      async agent() {
        providers += 1;
        assert.fail("blocked observations must not call Agent");
      },
      async report() {
        providers += 1;
        assert.fail("blocked observations must not call Report");
      },
    }),
  );

  assert.deepEqual(await service.startInterview(ids.session, ids.user), {
    done: true,
    completionReason: "insufficient_confirmed_evidence",
    reportReady: false,
  });
  assert.deepEqual(completion, {
    sessionId: ids.session,
    userId: ids.user,
    status: "completed_without_report",
    completionReason: "insufficient_confirmed_evidence",
    observationIds: [],
    answerTurnIds: [],
  });
  assert.equal(claims, 0);
  assert.equal(providers, 0);
  assert.equal(session.report, null);
});

test("manual stop persists both report-ready and paused outcomes without crossing branches", async () => {
  for (const reportReady of [true, false]) {
    const session = baseSession();
    const answer = actorAnswer(id(reportReady ? 20 : 30), 0);
    answer.reportEvidenceSelected = reportReady;
    session.observations = [acceptedObservation()];
    session.transcript = [answer];
    session.substantiveAnswerCount = 1;
    const harness = makeCompletionHarness({
      session,
      agentResponse: () => ({
        action: reportReady ? "close" : "pause",
        utterance: reportReady ? "complete" : "pause",
        evidence: { observationIds: reportReady ? [ids.observation] : [] },
        reportEvidence: {
          observationIds: reportReady ? [ids.observation] : [],
          answerTurnIds: reportReady ? [answer.id] : [],
        },
        done: reportReady,
        completionReason: reportReady
          ? "manual_stop_report_ready"
          : "manual_stop_paused",
        reportReady,
        model: "agent-model",
        promptVersion: "acting-agent.prompt.v2",
      }),
    });

    const result = await harness.service.stopInterview(ids.session, ids.user);

    assert.equal(result.reportReady, reportReady);
    assert.equal(
      result.completionReason,
      reportReady ? "manual_stop_report_ready" : "manual_stop_paused",
    );
    assert.equal(session.interviewStatus, reportReady ? "completed" : "paused");
    assert.equal(Boolean(result.report), reportReady);
    assert.deepEqual(harness.calls, {
      agentClaims: 1,
      agentProviders: 1,
      appends: 1,
      reportClaims: reportReady ? 1 : 0,
      reportProviders: reportReady ? 1 : 0,
      reportCompletes: reportReady ? 1 : 0,
    });
  }
});

test("the fifth substantive answer may complete and generates exactly one Report", async () => {
  const session = baseSession();
  session.observations = [acceptedObservation()];
  session.transcript = Array.from({ length: 4 }, (_, index) =>
    actorAnswer(id(40 + index), index),
  );
  session.substantiveAnswerCount = 4;
  const harness = makeCompletionHarness({
    session,
    agentResponse: (request) => ({
      action: "close",
      utterance: "complete",
      evidence: { observationIds: [ids.observation] },
      reportEvidence: {
        observationIds: [ids.observation],
        answerTurnIds: [request.currentInput.answerTurnId],
      },
      done: true,
      completionReason: "interview_complete_report_ready",
      reportReady: true,
      model: "agent-model",
      promptVersion: "acting-agent.prompt.v2",
    }),
  });

  const result = await harness.service.addTurn(ids.session, ids.user, {
    answer: "fifth answer",
    requestId: ids.request,
    expectedSubstantiveAnswerCount: 4,
    expectedTotalConversationCount: 4,
  });

  assert.equal(session.substantiveAnswerCount, 5);
  assert.equal(result.completionReason, "interview_complete_report_ready");
  assert.equal(result.reportReady, true);
  assert.ok(result.report);
  assert.deepEqual(harness.calls, {
    agentClaims: 1,
    agentProviders: 1,
    appends: 1,
    reportClaims: 1,
    reportProviders: 1,
    reportCompletes: 1,
  });
});

test("failed Report retry preserves Summary transcript and fingerprint and completes once", async () => {
  const session = baseSession();
  const answer = actorAnswer(id(60), 0, "persisted answer");
  answer.reportEvidenceSelected = true;
  const closing = {
    id: id(61),
    sequence: 1,
    role: "agent",
    kind: "closing",
    content: "done",
    questionFocus: null,
    groundingStartMs: null,
    groundingEndMs: null,
    sourceObservationIds: [ids.observation],
    reportEvidenceSelected: false,
  };
  const terminalAgentRunId = id(62);
  session.interviewStatus = "completed";
  session.completionReason = "manual_stop_report_ready";
  session.substantiveAnswerCount = 1;
  session.observations = [acceptedObservation()];
  session.transcript = [answer, closing];
  session.reportEvidenceObservationIds = [ids.observation];
  session.reportEvidenceAnswerTurnIds = [answer.id];
  session.runs = [
    {
      id: terminalAgentRunId,
      stage: "agent",
      status: "completed",
      responseSchemaVersion: "agent-turn.v1",
      model: "agent-model",
      promptVersion: "acting-agent.prompt.v2",
      attempt: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
      responsePayload: {
        actorTurn: null,
        agentTurn: structuredClone(closing),
        done: true,
        completionReason: "manual_stop_report_ready",
        reportReady: true,
        reportEvidence: {
          observationIds: [ids.observation],
          answerTurnIds: [answer.id],
        },
      },
    },
  ];

  const expectedRequestPayload = {
    schemaVersion: "report-request.v1",
    sessionId: ids.session,
    summarySourceRunId: ids.summaryRun,
    normalizedSummary: structuredClone(normalizedSummary),
    confirmedObservations: [
      {
        observationId: ids.observation,
        sourceCandidateId: ids.observation,
        segment: { startMs: 0, endMs: 1_000 },
        text: "grounded evidence",
        dimension: "voice",
      },
    ],
    actorCorrections: [],
    transcript: session.transcript.map((turn) => ({
      turnId: turn.id,
      speaker: turn.role,
      content: turn.content,
      kind: turn.kind,
    })),
    completionReason: "manual_stop_report_ready",
    selectedEvidence: {
      observationIds: [ids.observation],
      answerTurnIds: [answer.id],
    },
  };
  const expectedFingerprint = fingerprintJson(expectedRequestPayload);
  session.runs.push({
    id: id(63),
    stage: "report",
    status: "failed",
    idempotencyKey: `report:${terminalAgentRunId}`,
    attempt: 1,
    maxAttempts: 2,
    requestSchemaVersion: "report-request.v1",
    requestPayloadFingerprint: expectedFingerprint,
    retryable: true,
    safeErrorCode: "AI_UNAVAILABLE",
    completedAt: "2026-01-01T00:00:01.000Z",
  });

  const summaryBefore = structuredClone(session.summary);
  const transcriptBefore = structuredClone(session.transcript);
  const fingerprints = [];
  const providerRequests = [];
  let claims = 0;
  let completions = 0;
  const repository = {
    async findPipelineSessionForOwner() {
      return structuredClone(session);
    },
    async claimRun(input) {
      claims += 1;
      fingerprints.push(input.requestPayloadFingerprint);
      assert.equal(input.idempotencyKey, `report:${terminalAgentRunId}`);
      const failed = session.runs.find((run) => run.stage === "report");
      assert.equal(failed.status, "failed");
      assert.equal(input.requestPayloadFingerprint, failed.requestPayloadFingerprint);
      Object.assign(failed, {
        id: input.runId,
        status: "running",
        attempt: 2,
        retryable: false,
        safeErrorCode: null,
        completedAt: null,
      });
      return { owned: true, run: structuredClone(failed) };
    },
    async completeReportRun(input) {
      completions += 1;
      const run = session.runs.find((item) => item.id === input.runId);
      Object.assign(run, {
        status: "completed",
        responseSchemaVersion: "report.v1",
        responsePayload: {
          schemaVersion: "report.v1",
          sessionId: ids.session,
          runId: input.runId,
          model: input.model,
          promptVersion: input.promptVersion,
          sections: structuredClone(input.report.sections),
        },
        model: input.model,
        promptVersion: input.promptVersion,
        completedAt: "2026-01-01T00:00:02.000Z",
      });
      session.report = {
        sourceRunId: input.runId,
        schemaVersion: "report.v1",
        sections: structuredClone(input.report.sections),
      };
    },
    async findImmutableReport() {
      return structuredClone(session.report);
    },
    async failRun() {
      assert.fail("successful retry must not fail the Report run");
    },
  };
  const service = createAiPipelineService(
    dependencies(repository, {
      async report(request) {
        providerRequests.push(structuredClone(request));
        return {
          schemaVersion: "report.v1",
          sessionId: ids.session,
          runId: request.runId,
          model: "report-model",
          promptVersion: "acting-report.prompt.v2",
          sections: reportSections(answer.id),
        };
      },
    }),
  );

  const first = await service.retryReport(ids.session, ids.user);
  const second = await service.retryReport(ids.session, ids.user);

  assert.deepEqual(second, first);
  assert.deepEqual(session.summary, summaryBefore);
  assert.deepEqual(session.transcript, transcriptBefore);
  assert.deepEqual(fingerprints, [expectedFingerprint]);
  assert.equal(providerRequests.length, 1);
  assert.deepEqual(providerRequests[0].normalizedSummary, summaryBefore.normalizedSummary);
  assert.deepEqual(providerRequests[0].transcript, expectedRequestPayload.transcript);
  assert.equal(claims, 1);
  assert.equal(completions, 1);
  assert.equal(
    session.runs.filter((run) => run.stage === "report" && run.status === "completed").length,
    1,
  );
  assert.equal(session.runs.filter((run) => run.stage === "report").length, 1);
});
