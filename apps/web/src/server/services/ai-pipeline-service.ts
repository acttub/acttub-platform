import "server-only";

import { loadAiServiceConfig } from "@/server/ai/config";
import type { AgentRequest, CurrentInput, NormalizedSummary, ReportRequest, SummaryRequest } from "@/server/ai/contracts";
import { createAiTransport, AiServiceError } from "@/server/ai/transport";
import { fingerprintJson } from "@/server/ai-pipeline-fingerprint.js";
import { assertTerminalAtConversationLimit, createAiPipelineExecutionCore, interviewProgress, sanitizePublicAiPipelineAggregate } from "@/server/ai-pipeline-execution-core.js";
import type { AgentReplayPayload, AiRun, CompletionReason, ImmutableAiReport, InterviewTurn, PipelineSessionAggregate, ReportSection } from "@/server/repositories/ai-pipeline-types";
import { AiPipelinePersistenceError, supabaseAiPipelineRepository as repository } from "@/server/repositories/supabase-ai-pipeline-repository";
import { getCurrentConsentVersions, requireCurrentAiProcessingConsent } from "./auth-context";
import { coachSessionService } from "./coach-session-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppConfig } from "@/lib/config/env";
import { countReportableActorTurns } from "../ai-pipeline-runtime-rules.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unknownAnswers = new Set(["모르겠어요", "잘 모르겠어요", "unknown"]);
const correctionOnlyState = String.fromCharCode(114, 101, 106, 101, 99, 116, 101, 100) as PipelineSessionAggregate["observations"][number]["confirmationState"];

const defaultAiPipelineServiceDeps = Object.freeze({
  repository,
  createAiTransport,
  loadAiServiceConfig,
  requireCurrentAiProcessingConsent,
  getCurrentConsentVersions,
  coachSessionService,
  createSupabaseAdminClient,
  getAppConfig,
});

const executionCoreFor = (deps: typeof defaultAiPipelineServiceDeps, sessionId: string, userId: string) =>
  createAiPipelineExecutionCore<AiRun>({
    claimRun: async () => {
      throw new AiPipelineError(503, "EXECUTION_CORE_CLAIM_RUN_UNUSED");
    },
    readRun: async (runId: string) => {
      const committed = await deps.repository.findPipelineSessionForOwner(sessionId, userId);
      if (!committed) throw new AiPipelineError(404, "PIPELINE_SESSION_NOT_FOUND");
      const run = committed.runs.find((item) => item.id === runId);
      if (!run) throw new AiPipelineError(404, "AI_RUN_NOT_FOUND");
      return { owned: false, run };
    },
  });

export class AiPipelineError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 502 | 503, readonly code: string) {
    super(code);
    this.name = "AiPipelineError";
  }
}

export const createAiPipelineService = (deps = defaultAiPipelineServiceDeps) => {
const aggregate = async (sessionId: string, userId: string) => {
  const value = await deps.repository.findPipelineSessionForOwner(sessionId, userId);
  if (!value) throw new AiPipelineError(404, "PIPELINE_SESSION_NOT_FOUND");
  return value;
};

const publicAggregate = (value: PipelineSessionAggregate) => sanitizePublicAiPipelineAggregate({
  ...value,
  observations: value.observations.filter((item) => item.priority !== null && item.priority <= 3),
});

const currentInput = (command: CurrentInput["command"], extras: Partial<CurrentInput> = {}): CurrentInput => ({
  command,
  answer: null,
  answerTurnId: null,
  observationId: null,
  ...extras,
});

const actorTurnCount = (session: PipelineSessionAggregate) => countReportableActorTurns(session.transcript);

const ensureMutableInterviewSession = (session: PipelineSessionAggregate) => {
  if (session.interviewStatus === "completed" || session.interviewStatus === "completed_without_report")
    throw new AiPipelineError(409, "SESSION_NOT_MUTABLE");
};

const agentRequest = (session: PipelineSessionAggregate, runId: string, input: CurrentInput): AgentRequest => {
  if (!session.summary) throw new AiPipelineError(409, "SUMMARY_NOT_READY");
  return {
    schemaVersion: "agent-turn.v1",
    sessionId: session.sessionId,
    runId,
    normalizedSummary: session.summary.normalizedSummary,
    observations: session.observations
      .filter((item) => item.priority !== null && item.priority <= 3)
      .map((item) => ({ observationId: item.id, segment: { startMs: item.startMs, endMs: item.endMs }, text: item.text, confirmationState: item.confirmationState, blocked: item.blockedForQuestioning, confidence: null, priority: item.priority!, dimension: item.dimension ?? "general", severity: item.severity })),
    actorCorrections: session.corrections.map((item) => ({ correctionId: item.id, correctsObservationId: item.correctsObservationId, segment: item.segment, text: item.text, actorTurnId: item.correctionByTurnId })),
    transcript: session.transcript.map((item) => ({ turnId: item.id, speaker: item.role, content: item.content, kind: item.kind })),
    substantiveAnswerCount: session.substantiveAnswerCount,
    currentInput: input,
  };
};

const failRun = async (sessionId: string, userId: string, runId: string, error: unknown) => {
  const retryable = error instanceof AiServiceError && error.retryable;
  await deps.repository.failRun({ sessionId, userId, runId, safeErrorCode: retryable ? "AI_UNAVAILABLE" : "AI_INVALID_RESPONSE", retryable });
  throw new AiPipelineError(retryable ? 503 : 502, retryable ? "AI_UNAVAILABLE" : "AI_INVALID_RESPONSE");
};

const claimRun = async (input: Parameters<typeof deps.repository.claimRun>[0]) => {
  try {
    return await deps.repository.claimRun(input);
  } catch (error) {
    if (error instanceof AiPipelinePersistenceError && error.field === "request_payload_conflict") {
      throw new AiPipelineError(409, "REQUEST_PAYLOAD_CONFLICT");
    }
    throw error;
  }
};

const summaryClaimPayload = (session: PipelineSessionAggregate) => ({
  schemaVersion: "summary-request.v1",
  sessionId: session.sessionId,
  storageBucket: session.take.storageBucket,
  storagePath: session.take.storagePath,
  durationMs: session.take.durationMs,
  sceneContext: session.sceneContext,
});

const agentClaimPayload = (
  session: PipelineSessionAggregate,
  input: CurrentInput,
  requestId: string,
  expectedSubstantiveAnswerCount: number,
  expectedTotalConversationCount: number,
) => ({
  schemaVersion: "agent-turn.v1",
  sessionId: session.sessionId,
  command: input.command,
  requestId,
  answer: input.answer,
  observationId: input.observationId,
  expectedSubstantiveAnswerCount,
  expectedTotalConversationCount,
});

const isAgentReplayPayload = (value: AiRun["responsePayload"]): value is AgentReplayPayload =>
  value !== null && "actorTurn" in value && "agentTurn" in value && "done" in value && "reportEvidence" in value;

const isReportSection = (value: unknown): value is ReportSection =>
  typeof value === "object" && value !== null && "status" in value && "content" in value && "observationEvidenceIds" in value && "turnEvidenceIds" in value && "timestampRange" in value;

const isNormalizedSummary = (value: unknown): value is NormalizedSummary =>
  typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === "scene-summary.v1" && "summary" in value && "observation" in value && "anomalies" in value;

const replayCommittedAgentOutcome = (session: PipelineSessionAggregate, committedRun: AiRun) => {
  const response = isAgentReplayPayload(committedRun.responsePayload) ? committedRun.responsePayload : null;
  if (!response) throw new AiPipelineError(503, "AGENT_RESPONSE_PAYLOAD_MISSING");
  return {
    report: session.report,
    response,
    actorTurn: response.actorTurn,
    agentTurn: response.agentTurn,
    done: response.done,
    completionReason: response.completionReason,
    reportReady: response.reportReady,
    reportEvidence: response.reportEvidence,
  };
};

const reportClaimPayload = (session: PipelineSessionAggregate) => ({
  schemaVersion: "report-request.v1",
  sessionId: session.sessionId,
  summarySourceRunId: session.summary?.sourceRunId ?? null,
  normalizedSummary: session.summary?.normalizedSummary ?? null,
  confirmedObservations: session.observations
    .filter((item) => session.reportEvidenceObservationIds.includes(item.id))
    .map((item) => ({
      observationId: item.id,
      sourceCandidateId: item.candidateId,
      segment: { startMs: item.startMs, endMs: item.endMs },
      text: item.text,
      dimension: item.dimension,
    })),
  actorCorrections: session.corrections.map((item) => ({
    correctionId: item.id,
    correctsObservationId: item.correctsObservationId,
    segment: item.segment,
    text: item.text,
    actorTurnId: item.correctionByTurnId,
  })),
  transcript: session.transcript.map((item) => ({
    turnId: item.id,
    speaker: item.role,
    content: item.content,
    kind: item.kind,
  })),
  completionReason: session.completionReason,
  selectedEvidence: {
    observationIds: session.reportEvidenceObservationIds,
    answerTurnIds: session.reportEvidenceAnswerTurnIds,
  },
});

type ReportTransportResponse = {
  sections: {
    oneLineSummary: ImmutableAiReport["oneLineSummary"];
    primaryReviewPoint: ImmutableAiReport["primaryReviewPoint"];
    confirmedEvidence: ImmutableAiReport["confirmedEvidence"];
    actorDiscovery: ImmutableAiReport["actorDiscovery"];
    groundedEncouragement: ImmutableAiReport["groundedEncouragement"];
    nextPracticeStep: ImmutableAiReport["nextPracticeStep"];
  };
  model: unknown;
  promptVersion: unknown;
};

const requireReportTransportResponse = (value: Record<string, unknown>): ReportTransportResponse => {
  if (typeof value.sections !== "object" || value.sections === null) throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
  const sections = value.sections;
  if (!("oneLineSummary" in sections) || !isReportSection(sections.oneLineSummary) || !("primaryReviewPoint" in sections) || !isReportSection(sections.primaryReviewPoint) || !("confirmedEvidence" in sections) || !isReportSection(sections.confirmedEvidence) || !("actorDiscovery" in sections) || !isReportSection(sections.actorDiscovery) || !("groundedEncouragement" in sections) || !isReportSection(sections.groundedEncouragement) || !("nextPracticeStep" in sections) || !isReportSection(sections.nextPracticeStep)) throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
  return {
    sections: {
      oneLineSummary: sections.oneLineSummary,
      primaryReviewPoint: sections.primaryReviewPoint,
      confirmedEvidence: sections.confirmedEvidence,
      actorDiscovery: sections.actorDiscovery,
      groundedEncouragement: sections.groundedEncouragement,
      nextPracticeStep: sections.nextPracticeStep,
    },
    model: value.model,
    promptVersion: value.promptVersion,
  };
};

type ReportExecutionResult = {
  report: ImmutableAiReport | null;
  response: ReportTransportResponse | null;
};

const reportExecutionResult = (report: ImmutableAiReport | null, response: ReportTransportResponse | null = null): ReportExecutionResult => ({ report, response });

const generateReport = async (
  session: PipelineSessionAggregate,
  userId: string,
  idempotencyKey: string,
  maxAttempts: number,
) => {
  await deps.requireCurrentAiProcessingConsent(userId);
  if (session.report) return session.report;
  if (!session.summary || !session.completionReason?.endsWith("_report_ready")) throw new AiPipelineError(409, "REPORT_NOT_READY");
  const summary = session.summary;
  const proposedRunId = crypto.randomUUID();
  const core = executionCoreFor(deps, session.sessionId, userId);
  const result = await core.run({
    claim: async () => claimRun({
      sessionId: session.sessionId,
      userId,
      stage: "report",
      runId: proposedRunId,
      idempotencyKey,
      maxAttempts,
      requestSchemaVersion: "report-request.v1",
      requestPayloadFingerprint: fingerprintJson(reportClaimPayload(session)),
      model: "report",
      promptVersion: "acting-report.prompt.v2",
    }),
    invoke: async (run): Promise<ReportExecutionResult> => {
      const confirmed = session.observations.filter((item) => session.reportEvidenceObservationIds.includes(item.id));
      const request: ReportRequest = {
        schemaVersion: "report-request.v1",
        sessionId: session.sessionId,
        runId: run.id,
        normalizedSummary: summary.normalizedSummary,
        confirmedObservations: confirmed.map((item) => ({ observationId: item.id, sourceCandidateId: item.candidateId!, segment: { startMs: item.startMs, endMs: item.endMs }, text: item.text, dimension: item.dimension! })),
        actorCorrections: session.corrections.map((item) => ({ correctionId: item.id, correctsObservationId: item.correctsObservationId, segment: item.segment, text: item.text, actorTurnId: item.correctionByTurnId })),
        transcript: session.transcript.map((item) => ({ turnId: item.id, speaker: item.role, content: item.content, kind: item.kind })),
        completionReason: session.completionReason as ReportRequest["completionReason"],
        selectedEvidence: { observationIds: session.reportEvidenceObservationIds, answerTurnIds: session.reportEvidenceAnswerTurnIds },
      };
      await deps.requireCurrentAiProcessingConsent(userId);
      const response = await deps.createAiTransport(deps.loadAiServiceConfig()).report(request);
      return reportExecutionResult(null, requireReportTransportResponse(response));
    },
    persist: async (invoked, run) => {
      const response = invoked.response ?? (() => { throw new AiPipelineError(503, "REPORT_RESPONSE_MISSING"); })();
      await deps.repository.completeReportRun({ sessionId: session.sessionId, userId, runId: run.id, report: { schemaVersion: "report.v1", sections: response.sections }, model: String(response.model), promptVersion: String(response.promptVersion) });
    },
    replay: (run) => reportExecutionResult(session.report, run.responsePayload as ReportTransportResponse | null),
    recover: async (_error, run) => {
      const committed = await aggregate(session.sessionId, userId);
      const committedRun = committed.runs.find((item) => item.id === run.id && item.stage === "report" && item.status === "completed");
      if (committedRun && committed.report?.sourceRunId === run.id) return reportExecutionResult(committed.report);
      return null;
    },
    providerFailure: async (error, run) => failRun(session.sessionId, userId, run.id, error),
    persistenceFailure: async (_error, run) => {
      await deps.repository.failRun({ sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "REPORT_PERSISTENCE_FAILED", retryable: true });
      throw new AiPipelineError(503, "REPORT_PERSISTENCE_FAILED");
    },
  });
  if (result?.report) return result.report;
  const committed = await aggregate(session.sessionId, userId);
  if (committed.report) return committed.report;
  const existing = await deps.repository.findImmutableReport(session.sessionId, userId);
  if (existing) return existing;
  throw new AiPipelineError(404, "REPORT_NOT_FOUND");
};

const latestCompletedAgentRun = (session: PipelineSessionAggregate) =>
  [...session.runs]
    .filter((run) => run.stage === "agent" && run.status === "completed" && run.responseSchemaVersion === "agent-turn.v1")
    .sort((a, b) => (a.completedAt ?? a.startedAt ?? "").localeCompare(b.completedAt ?? b.startedAt ?? "") || a.attempt - b.attempt || a.id.localeCompare(b.id))
    .at(-1) ?? null;

type AgentTransportResponse = Record<string, unknown> & {
  action: unknown;
  completionReason: unknown;
  model: unknown;
  promptVersion: unknown;
};

type AgentExecutionResult = ReturnType<typeof replayCommittedAgentOutcome> & {
  transportResponse: AgentTransportResponse | null;
  claimedRunId: string;
  persistedInput: CurrentInput;
};

const callAgent = async (session: PipelineSessionAggregate, userId: string, input: CurrentInput, expectedSubstantiveAnswerCount = session.substantiveAnswerCount, expectedTotalConversationCount = actorTurnCount(session), requestId = crypto.randomUUID()) => {
  await deps.requireCurrentAiProcessingConsent(userId);
  if (!UUID.test(requestId) || !Number.isInteger(expectedSubstantiveAnswerCount) || expectedSubstantiveAnswerCount < 0 || !Number.isInteger(expectedTotalConversationCount) || expectedTotalConversationCount < 0 || expectedSubstantiveAnswerCount > expectedTotalConversationCount || expectedTotalConversationCount > 10) throw new AiPipelineError(400, "INVALID_INTERVIEW_TURN");
  const runId = crypto.randomUUID();
  const requestPayload = agentClaimPayload(session, input, requestId, expectedSubstantiveAnswerCount, expectedTotalConversationCount);
  const core = executionCoreFor(deps, session.sessionId, userId);
  const result = await core.run<AgentExecutionResult>({
    claim: async () => claimRun({
      sessionId: session.sessionId,
      userId,
      stage: "agent",
      runId,
      idempotencyKey: input.command === "answer" && requestId ? `answer:${requestId}` : `${input.command}:${session.substantiveAnswerCount}:${expectedTotalConversationCount}`,
      maxAttempts: 1,
      requestSchemaVersion: "agent-turn.v1",
      requestPayloadFingerprint: fingerprintJson(requestPayload),
      model: "agent",
      promptVersion: "acting-agent.prompt.v2",
    }),
    invoke: async (run) => {
      if (session.substantiveAnswerCount !== expectedSubstantiveAnswerCount || actorTurnCount(session) !== expectedTotalConversationCount) throw new AiPipelineError(409, "STALE_INTERVIEW_PROGRESS");
      if (expectedTotalConversationCount >= 10) throw new AiPipelineError(409, "SESSION_NOT_MUTABLE");
      const actorTurn: InterviewTurn | null = input.command === "answer" && input.answer
        ? { id: crypto.randomUUID(), sequence: session.transcript.length, role: "actor", kind: unknownAnswers.has(input.answer) ? "unknown" : "answer", content: input.answer, questionFocus: null, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: [], reportEvidenceSelected: false }
        : null;
      const persistedInput = actorTurn ? { ...input, answerTurnId: actorTurn.id } : input;
      const requestSession = actorTurn
        ? {
            ...session,
            transcript: [...session.transcript, actorTurn],
            substantiveAnswerCount: session.substantiveAnswerCount + (actorTurn.kind === "answer" ? 1 : 0),
          }
        : session;
      const request = agentRequest(requestSession, run.id, persistedInput);
      await deps.requireCurrentAiProcessingConsent(userId);
      const response = await deps.createAiTransport(deps.loadAiServiceConfig()).agent(request);
      const action = String(response.action);
      const done = response.done === true;
      const completionReason = (response.completionReason === null ? null : String(response.completionReason)) as CompletionReason | null;
      const reportReady = response.reportReady === true;
      assertTerminalAtConversationLimit({ actual: interviewProgress(requestSession.transcript), done, reportReady, completionReason, fail: (code) => { throw new AiPipelineError(409, code); } });
      const reportEvidence = response.reportEvidence as { observationIds: string[]; answerTurnIds: string[] };
      if (actorTurn) actorTurn.reportEvidenceSelected = actorTurn.kind === "answer" && reportEvidence.answerTurnIds.includes(actorTurn.id);
      const agentTurn: InterviewTurn = { id: crypto.randomUUID(), sequence: session.transcript.length + (actorTurn ? 1 : 0), role: "agent", kind: done ? "closing" : "question", content: String(response.utterance), questionFocus: action, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: (response.evidence as { observationIds: string[] }).observationIds, reportEvidenceSelected: false };
      const responsePayload: AgentReplayPayload = { actorTurn, agentTurn, done, completionReason, reportReady, reportEvidence };
      return { report: null, response: responsePayload, transportResponse: response as AgentTransportResponse, claimedRunId: run.id, persistedInput, actorTurn, agentTurn, done, completionReason, reportReady, reportEvidence };
    },
    persist: async (invoked, run) => {
      await deps.repository.appendPipelineTurn({
        sessionId: session.sessionId,
        userId,
        agentRunId: run.id,
        requestId,
        expectedSubstantiveAnswerCount,
        expectedTotalConversationCount,
        actorTurn: invoked.actorTurn,
        agentTurn: invoked.agentTurn,
        responsePayload: { actorTurn: invoked.actorTurn, agentTurn: invoked.agentTurn, done: invoked.done, completionReason: invoked.completionReason, reportReady: invoked.reportReady, reportEvidence: invoked.reportEvidence },
        model: String(invoked.transportResponse?.model),
        promptVersion: String(invoked.transportResponse?.promptVersion),
        currentInput: invoked.persistedInput,
        reportEvidence: invoked.reportEvidence,
        completionStatus: invoked.done || String(invoked.transportResponse?.action) === "pause" ? (invoked.reportReady ? "completed" : String(invoked.transportResponse?.action) === "pause" ? "paused" : "completed_without_report") : null,
        completionReason: invoked.done || String(invoked.transportResponse?.action) === "pause" ? invoked.completionReason : null,
      });
    },
    replay: (run) => ({ ...replayCommittedAgentOutcome(session, run), transportResponse: null, claimedRunId: run.id, persistedInput: input }),
    recover: async (_error, claimedRun) => {
      const committed = await aggregate(session.sessionId, userId);
      const committedRun = committed.runs.find((run) => run.id === claimedRun.id && run.stage === "agent" && run.status === "completed" && run.responseSchemaVersion === "agent-turn.v1");
      if (committedRun) return { ...replayCommittedAgentOutcome(committed, committedRun), transportResponse: null, claimedRunId: committedRun.id, persistedInput: input };
      return null;
    },
    providerFailure: async (error, run) => failRun(session.sessionId, userId, run.id, error),
    persistenceFailure: async (_error, run) => {
      await deps.repository.failRun({ sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "TURN_PERSISTENCE_FAILED", retryable: true });
      throw new AiPipelineError(503, "TURN_PERSISTENCE_FAILED");
    },
  });
  const { transportResponse: _transportResponse, claimedRunId, persistedInput: _persistedInput, ...publicResult } = result;
  if (publicResult.reportReady && !publicResult.report) {
    const report = await generateReport(await aggregate(session.sessionId, userId), userId, `report:${claimedRunId}`, 2);
    return { ...publicResult, report };
  }
  return publicResult;
};

return {
  async createSession(body:unknown,userId:string){
    const input=body as Record<string,unknown>;const required=(key:string)=>{const value=input[key];if(typeof value!=="string"||!value.trim())throw new AiPipelineError(400,"INVALID_PIPELINE_SESSION");return value.trim()};
    const allowed=new Set(["sessionId","uploadIntentId","storagePath","genre","situation","characterContext","subtext"]);if(Object.keys(input).some((key)=>!allowed.has(key)))throw new AiPipelineError(400,"INVALID_PIPELINE_SESSION");
    const sessionId=required("sessionId"),uploadIntentId=required("uploadIntentId"),storagePath=required("storagePath"),genre=required("genre"),situation=required("situation"),characterContext=required("characterContext"),subtext=typeof input.subtext==="string"&&input.subtext.trim()?input.subtext.trim():null;
    await deps.requireCurrentAiProcessingConsent(userId);const consent=await deps.getCurrentConsentVersions();const upload=await deps.repository.findEligibleUpload(uploadIntentId,userId);if(!upload||upload.sessionId!==sessionId||upload.storagePath!==storagePath||upload.requiredConsentVersionSnapshot!==consent.requiredConsentVersion||upload.aiProcessingConsentVersionSnapshot!==consent.aiProcessingConsentVersion)throw new AiPipelineError(409,"UPLOAD_NOT_AI_ELIGIBLE");
    const takeId=crypto.randomUUID();await deps.repository.createPipelineSession({uploadIntentId,userId,sessionId,takeId,payload:{medium:"upload_url",genre,situation,characterContext,subtext}});
    const persisted=await aggregate(sessionId,userId);
    const proposedRunId=crypto.randomUUID();
    const core=executionCoreFor(deps,sessionId,userId);
    const result=await core.run<{session:PipelineSessionAggregate;summaryRun:AiRun;response:Record<string,unknown>|null}>({
      claim:()=>claimRun({sessionId,userId,stage:"summary",runId:proposedRunId,idempotencyKey:`summary:${uploadIntentId}`,maxAttempts:1,requestSchemaVersion:"summary-request.v1",requestPayloadFingerprint:fingerprintJson(summaryClaimPayload(persisted)),model:"summary",promptVersion:"acting-summary.prompt.v2"}),
      invoke:async(run)=>{await deps.requireCurrentAiProcessingConsent(userId);const admin=deps.createSupabaseAdminClient();if(!admin)throw new AiPipelineError(503,"SIGNED_VIDEO_UNAVAILABLE");const signed=await admin.storage.from(persisted.take.storageBucket).createSignedUrl(persisted.take.storagePath,deps.getAppConfig().video.signedUrlExpiresInSeconds);if(signed.error||!signed.data?.signedUrl)throw new AiServiceError("summary","NETWORK_ERROR",null,true);const request:SummaryRequest={schemaVersion:"summary-request.v1",sessionId,runId:run.id,signedVideoUrl:signed.data.signedUrl,storageBucket:persisted.take.storageBucket,storagePath:persisted.take.storagePath,durationMs:persisted.take.durationMs,sceneContext:persisted.sceneContext};await deps.requireCurrentAiProcessingConsent(userId);return{session:persisted,summaryRun:run,response:await deps.createAiTransport(deps.loadAiServiceConfig()).summary(request)}} ,
      persist:async(invoked,run)=>{const response=invoked.response;if(!response||!Array.isArray(response.observationCandidates)||!isNormalizedSummary(response.normalizedSummary))throw new AiPipelineError(502,"AI_INVALID_RESPONSE");const candidates=response.observationCandidates.map((value)=>{if(typeof value!=="object"||value===null)throw new AiPipelineError(502,"AI_INVALID_RESPONSE");const item=Object.fromEntries(Object.entries(value));const severity:"high"|"mid"|"low"|null=item.severity===null?null:item.severity==="high"||item.severity==="mid"||item.severity==="low"?item.severity:(()=>{throw new AiPipelineError(502,"AI_INVALID_RESPONSE")})();return{id:String(item.candidateId),startMs:Number(item.timestampStartMs),endMs:Number(item.timestampEndMs),text:String(item.observationText),priority:Number(item.priority),dimension:String(item.dimension),severity}});await deps.repository.completeSummaryRun({sessionId,userId,runId:run.id,normalizedSummary:response.normalizedSummary,candidates,model:String(response.model),promptVersion:String(response.promptVersion)})},
      replay:run=>({session:persisted,summaryRun:run,response:null}),
      recover:async(_error,run)=>{const committed=await aggregate(sessionId,userId);const summaryRun=committed.runs.find(item=>item.id===run.id&&item.stage==="summary"&&item.status==="completed");return summaryRun&&committed.summary?.sourceRunId===run.id?{session:committed,summaryRun,response:null}:null},
      providerFailure:(error,run)=>failRun(sessionId,userId,run.id,error),
      persistenceFailure:async(_error,run)=>{await deps.repository.failRun({sessionId,userId,runId:run.id,safeErrorCode:"SUMMARY_PERSISTENCE_FAILED",retryable:true});throw new AiPipelineError(503,"SUMMARY_PERSISTENCE_FAILED")},
    });
    const refreshed=result.response?await aggregate(sessionId,userId):result.session;
    const summaryRun=refreshed.runs.find(run=>run.id===result.summaryRun.id)??result.summaryRun;
    return{session:publicAggregate(refreshed),summaryRun};
  },
  async getSession(sessionId: string, userId: string) { return publicAggregate(await aggregate(sessionId, userId)); },
  async confirmObservation(sessionId: string, observationId: string, userId: string, body: unknown) {
    const session = await aggregate(sessionId, userId);
    const payload = body as { state?: unknown; correction?: unknown };
    if (!session.observations.some((item) => item.id === observationId && item.priority !== null && item.priority <= 3)) throw new AiPipelineError(404, "OBSERVATION_NOT_FOUND");
    ensureMutableInterviewSession(session);
    if (!(["accepted", correctionOnlyState, "unsure"] as unknown[]).includes(payload.state) || (payload.correction !== undefined && (payload.state !== correctionOnlyState || typeof payload.correction !== "string" || !payload.correction.trim()))) throw new AiPipelineError(400, "INVALID_CONFIRMATION");
    await deps.repository.confirmObservation({ sessionId, userId, observationId, state: payload.state as Exclude<PipelineSessionAggregate["observations"][number]["confirmationState"], "unasked">, correction: typeof payload.correction === "string" ? { id: crypto.randomUUID(), turnId: crypto.randomUUID(), text: payload.correction.trim() } : null });
    return this.getSession(sessionId, userId);
  },
  async startInterview(sessionId: string, userId: string) {
    const session = await aggregate(sessionId, userId);
    if (!session.observations.some((item) => item.confirmationState === "accepted" && !item.blockedForQuestioning)) { await deps.repository.completeInterview({ sessionId, userId, status: "completed_without_report", completionReason: "insufficient_confirmed_evidence", observationIds: [], answerTurnIds: [] }); return { done: true, completionReason: "insufficient_confirmed_evidence", reportReady: false }; }
    return callAgent(session, userId, currentInput("start"));
  },
  async addTurn(sessionId: string, userId: string, body: unknown) {
    const payload = body as { answer?: unknown; requestId?: unknown; expectedSubstantiveAnswerCount?: unknown; expectedTotalConversationCount?: unknown };
    if (typeof payload.answer !== "string" || !payload.answer.trim() || !Number.isInteger(payload.expectedSubstantiveAnswerCount) || !Number.isInteger(payload.expectedTotalConversationCount) || typeof payload.requestId !== "string" || !UUID.test(payload.requestId)) throw new AiPipelineError(400, "INVALID_INTERVIEW_TURN");
    const session = await aggregate(sessionId, userId);
    const answer = payload.answer.trim();
    return callAgent(session, userId, currentInput("answer", { answer }), Number(payload.expectedSubstantiveAnswerCount), Number(payload.expectedTotalConversationCount), payload.requestId);
  },
  async stopInterview(sessionId: string, userId: string) { const session = await aggregate(sessionId, userId); return callAgent(session, userId, currentInput("manual_stop")); },
  async resumeInterview(sessionId: string, userId: string) { const session = await aggregate(sessionId, userId); if (session.interviewStatus !== "paused") throw new AiPipelineError(409, "INTERVIEW_NOT_PAUSED"); return callAgent(session, userId, currentInput("resume")); },
  async getReport(sessionId: string, userId: string) { const session = await aggregate(sessionId, userId); if (!session.report) throw new AiPipelineError(404, "REPORT_NOT_FOUND"); return session.report; },
  async retryReport(sessionId: string, userId: string) {
    const session = await aggregate(sessionId, userId);
    if (session.report) return session.report;
    const failed = [...session.runs].filter((run) => run.stage === "report" && run.status === "failed" && run.retryable).sort((a,b)=>(a.completedAt??a.startedAt??"").localeCompare(b.completedAt??b.startedAt??"")||a.attempt-b.attempt||a.id.localeCompare(b.id)).at(-1);
    const running = [...session.runs].filter((run) => run.stage === "report" && run.status === "running").sort((a,b)=>(a.startedAt??"").localeCompare(b.startedAt??"")||a.attempt-b.attempt||a.id.localeCompare(b.id)).at(-1);
    const terminalAgentRun = latestCompletedAgentRun(session);
    if (!session.summary || !session.completionReason?.endsWith("_report_ready") || (!failed && !running && !terminalAgentRun)) throw new AiPipelineError(409, "REPORT_NOT_RETRYABLE");
    return generateReport(session, userId, failed?.idempotencyKey ?? running?.idempotencyKey ?? `report:${terminalAgentRun!.id}`, failed?.maxAttempts ?? running?.maxAttempts ?? 2);
  },
  validateRequestId(value: string | null) { if (!value || !UUID.test(value)) throw new AiPipelineError(400, "INVALID_IDEMPOTENCY_KEY"); return value; },
  async deleteSession(sessionId:string,userId:string,requestId:string){
    const previous=await deps.repository.findDeletionAttempt(sessionId,userId,requestId);if(previous?.status==="completed")return{requestId,status:"completed" as const};
    const session=await deps.coachSessionService.getSessionIncludingHidden(sessionId,userId); if(!session)throw new AiPipelineError(404,"SESSION_NOT_FOUND");
    const prefix=`supabase://${deps.getAppConfig().video.bucket}/`; const path=session.take.videoUrl?.startsWith(prefix)?session.take.videoUrl.slice(prefix.length):null;
    await deps.repository.beginDelete({sessionId,userId,requestId});
    const existingAttempt=await deps.repository.findDeletionAttempt(sessionId,userId,requestId);
    let storageDeleted=existingAttempt?.storageDeleted===true;
    if(storageDeleted){try{await deps.repository.completeDelete({sessionId,userId,requestId});return{requestId,status:"completed" as const}}catch{await deps.repository.failDelete({sessionId,userId,requestId,safeErrorCode:"DELETE_ROWS_FAILED"});throw new AiPipelineError(503,"DELETE_ROWS_FAILED")}}
    try{const admin=deps.createSupabaseAdminClient();if(!admin||!path)throw new Error("storage");const bucket=admin.storage.from(deps.getAppConfig().video.bucket);const removed=await bucket.remove([path]);if(removed.error)throw new Error("storage");const parts=path.split("/"),name=parts.pop(),directory=parts.join("/");const verification=await bucket.list(directory,{limit:100,search:name});if(verification.error||verification.data?.some((item)=>item.name===name)){await deps.repository.failDelete({sessionId,userId,requestId,safeErrorCode:"DELETE_VERIFICATION_FAILED"});throw new AiPipelineError(503,"DELETE_VERIFICATION_FAILED")}await deps.repository.recordStorageDeleted({sessionId,userId,requestId});storageDeleted=true;await deps.repository.completeDelete({sessionId,userId,requestId});return{requestId,status:"completed" as const};}
    catch(error){if(error instanceof AiPipelineError)throw error;const code=storageDeleted?"DELETE_ROWS_FAILED":"DELETE_STORAGE_FAILED";await deps.repository.failDelete({sessionId,userId,requestId,safeErrorCode:code});throw new AiPipelineError(503,code)}
  },
  async reconcileDeletionAttempts(userId:string,limit=25){const bounded=Math.max(1,Math.min(100,Math.trunc(limit)));const candidates=(await deps.repository.listDeletionReconciliationCandidates(userId)).slice(0,bounded);const results=[];for(const item of candidates){try{results.push(await this.deleteSession(item.sessionId,userId,item.requestId))}catch{results.push({requestId:item.requestId,status:"failed" as const})}}return{processed:results.length,results}},
  async getDeletionStatus(sessionId:string,userId:string,requestId:string){const value=await deps.repository.findDeletionAttempt(sessionId,userId,requestId);if(!value)throw new AiPipelineError(404,"DELETION_NOT_FOUND");return value;},
};
};
export const aiPipelineService = createAiPipelineService();
