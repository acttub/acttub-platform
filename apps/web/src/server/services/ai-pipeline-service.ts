import "server-only";

import { loadAiServiceConfig } from "@/server/ai/config";
import type { AgentRequest, CurrentInput, ReportRequest } from "@/server/ai/contracts";
import { createAiTransport, AiServiceError } from "@/server/ai/transport";
import type { InterviewTurn, PipelineSessionAggregate } from "@/server/repositories/ai-pipeline-types";
import { supabaseAiPipelineRepository as repository } from "@/server/repositories/supabase-ai-pipeline-repository";
import { requireCurrentAiProcessingConsent } from "./auth-context";
import { coachSessionService } from "./coach-session-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppConfig } from "@/lib/config/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const unknownAnswers = new Set(["모르겠어요", "잘 모르겠어요", "unknown"]);
const correctionOnlyState = String.fromCharCode(114, 101, 106, 101, 99, 116, 101, 100) as PipelineSessionAggregate["observations"][number]["confirmationState"];

export class AiPipelineError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 502 | 503, readonly code: string) {
    super(code);
    this.name = "AiPipelineError";
  }
}

const aggregate = async (sessionId: string, userId: string) => {
  const value = await repository.findPipelineSessionForOwner(sessionId, userId);
  if (!value) throw new AiPipelineError(404, "PIPELINE_SESSION_NOT_FOUND");
  return value;
};

const publicAggregate = (value: PipelineSessionAggregate) => ({
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
  await repository.failRun({ sessionId, userId, runId, safeErrorCode: retryable ? "AI_UNAVAILABLE" : "AI_INVALID_RESPONSE", retryable });
  throw new AiPipelineError(retryable ? 503 : 502, retryable ? "AI_UNAVAILABLE" : "AI_INVALID_RESPONSE");
};

const callAgent = async (session: PipelineSessionAggregate, userId: string, input: CurrentInput, actorTurn: InterviewTurn | null) => {
  await requireCurrentAiProcessingConsent(userId);
  const runId = crypto.randomUUID();
  const claimed = await repository.claimRun({ sessionId: session.sessionId, userId, stage: "agent", runId, idempotencyKey: `${input.command}:${actorTurn?.id ?? session.substantiveAnswerCount}`, maxAttempts: 1, requestSchemaVersion: "agent-turn.v1", model: "agent", promptVersion: "agent-turn.v1" });
  if (claimed.id !== runId || claimed.status !== "running") throw new AiPipelineError(409, "AI_RUN_ALREADY_CLAIMED");
  const requestSession = actorTurn ? { ...session, transcript: [...session.transcript, actorTurn], substantiveAnswerCount: session.substantiveAnswerCount + 1 } : session;
  const request = agentRequest(requestSession, runId, input);
  let response: Record<string, unknown>;
  try { response = await createAiTransport(loadAiServiceConfig()).agent(request); }
  catch (error) { return failRun(session.sessionId, userId, runId, error); }
  const action = String(response.action);
  const done = response.done === true;
  const evidence = response.reportEvidence as { observationIds: string[]; answerTurnIds: string[] };
  if (actorTurn) actorTurn.reportEvidenceSelected = actorTurn.kind === "answer" && evidence.answerTurnIds.includes(actorTurn.id);
  const agentTurn: InterviewTurn = { id: crypto.randomUUID(), sequence: session.transcript.length + (actorTurn ? 1 : 0), role: "agent", kind: done ? "closing" : "question", content: String(response.utterance), questionFocus: action, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: (response.evidence as { observationIds: string[] }).observationIds, reportEvidenceSelected: false };
  await repository.appendPipelineTurn({ sessionId: session.sessionId, userId, agentRunId: runId, expectedSubstantiveAnswerCount: session.substantiveAnswerCount, actorTurn, agentTurn, currentInput: input, reportEvidence: evidence });
  if (done || action === "pause") await repository.completeInterview({ sessionId: session.sessionId, userId, status: response.reportReady ? "completed" : action === "pause" ? "paused" : "completed_without_report", completionReason: response.completionReason as never, observationIds: evidence.observationIds, answerTurnIds: evidence.answerTurnIds });
  return { actorTurn, agentTurn, done, completionReason: response.completionReason, reportReady: response.reportReady, reportEvidence: evidence };
};

export const aiPipelineService = {
  async getSession(sessionId: string, userId: string) { return publicAggregate(await aggregate(sessionId, userId)); },
  async confirmObservation(sessionId: string, observationId: string, userId: string, body: unknown) {
    const session = await aggregate(sessionId, userId);
    const payload = body as { state?: unknown; correction?: unknown };
    if (!session.observations.some((item) => item.id === observationId && item.priority !== null && item.priority <= 3)) throw new AiPipelineError(404, "OBSERVATION_NOT_FOUND");
    if (!(["accepted", correctionOnlyState, "unsure"] as unknown[]).includes(payload.state) || (payload.correction !== undefined && (payload.state !== correctionOnlyState || typeof payload.correction !== "string" || !payload.correction.trim()))) throw new AiPipelineError(400, "INVALID_CONFIRMATION");
    await repository.confirmObservation({ sessionId, userId, observationId, state: payload.state as Exclude<PipelineSessionAggregate["observations"][number]["confirmationState"], "unasked">, correction: typeof payload.correction === "string" ? { id: crypto.randomUUID(), turnId: crypto.randomUUID(), text: payload.correction.trim() } : null });
    return this.getSession(sessionId, userId);
  },
  async startInterview(sessionId: string, userId: string) {
    const session = await aggregate(sessionId, userId);
    if (!session.observations.some((item) => item.confirmationState === "accepted" && !item.blockedForQuestioning)) { await repository.completeInterview({ sessionId, userId, status: "completed_without_report", completionReason: "insufficient_confirmed_evidence", observationIds: [], answerTurnIds: [] }); return { done: true, completionReason: "insufficient_confirmed_evidence", reportReady: false }; }
    return callAgent(session, userId, currentInput("start"), null);
  },
  async addTurn(sessionId: string, userId: string, body: unknown) {
    const payload = body as { answer?: unknown; expectedSubstantiveAnswerCount?: unknown };
    if (typeof payload.answer !== "string" || !payload.answer.trim() || !Number.isInteger(payload.expectedSubstantiveAnswerCount)) throw new AiPipelineError(400, "INVALID_INTERVIEW_TURN");
    const session = await aggregate(sessionId, userId);
    if (payload.expectedSubstantiveAnswerCount !== session.substantiveAnswerCount) throw new AiPipelineError(409, "INTERVIEW_TURN_CONFLICT");
    const answer = payload.answer.trim();
    const actorTurn: InterviewTurn = { id: crypto.randomUUID(), sequence: session.transcript.length, role: "actor", kind: unknownAnswers.has(answer) ? "unknown" : "answer", content: answer, questionFocus: null, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: [], reportEvidenceSelected: false };
    return callAgent(session, userId, currentInput("answer", { answer, answerTurnId: actorTurn.id }), actorTurn);
  },
  async stopInterview(sessionId: string, userId: string) { const session = await aggregate(sessionId, userId); return callAgent(session, userId, currentInput("manual_stop"), null); },
  async resumeInterview(sessionId: string, userId: string) { const session = await aggregate(sessionId, userId); if (session.interviewStatus !== "paused") throw new AiPipelineError(409, "INTERVIEW_NOT_PAUSED"); return callAgent(session, userId, currentInput("resume"), null); },
  async getReport(sessionId: string, userId: string) { const report = await repository.findImmutableReport(sessionId, userId); if (!report) throw new AiPipelineError(404, "REPORT_NOT_FOUND"); return report; },
  async retryReport(sessionId: string, userId: string) {
    const session = await aggregate(sessionId, userId);
    if (session.report) return session.report;
    const failed = session.runs.filter((run) => run.stage === "report" && run.status === "failed" && run.retryable).at(-1);
    if (!failed || !session.summary || !session.completionReason?.endsWith("_report_ready")) throw new AiPipelineError(409, "REPORT_NOT_RETRYABLE");
    const runId = crypto.randomUUID(); const claimed=await repository.claimRun({ sessionId, userId, stage: "report", runId, idempotencyKey: failed.idempotencyKey, maxAttempts: failed.maxAttempts, requestSchemaVersion: "report-request.v1", model: "report", promptVersion: "acting-report.prompt.v2" });if(claimed.id!==runId||claimed.status!=="running")throw new AiPipelineError(409,"AI_RUN_ALREADY_CLAIMED");
    const confirmed = session.observations.filter((item) => session.reportEvidenceObservationIds.includes(item.id));
    const request: ReportRequest = { schemaVersion: "report-request.v1", sessionId, runId, normalizedSummary: session.summary.normalizedSummary, confirmedObservations: confirmed.map((item) => ({ observationId: item.id, sourceCandidateId: item.candidateId!, segment: { startMs: item.startMs, endMs: item.endMs }, text: item.text, dimension: item.dimension! })), actorCorrections: session.corrections.map((item) => ({ correctionId: item.id, correctsObservationId: item.correctsObservationId, segment: item.segment, text: item.text, actorTurnId: item.correctionByTurnId })), transcript: session.transcript.map((item) => ({ turnId: item.id, speaker: item.role, content: item.content, kind: item.kind })), completionReason: session.completionReason as ReportRequest["completionReason"], selectedEvidence: { observationIds: session.reportEvidenceObservationIds, answerTurnIds: session.reportEvidenceAnswerTurnIds } };
    let response: Record<string, unknown>; try { response = await createAiTransport(loadAiServiceConfig()).report(request); } catch (error) { return failRun(sessionId, userId, runId, error); }
    await repository.completeReportRun({ sessionId, userId, runId, report: { schemaVersion: "report.v1", sections: response.sections as never } });
    return this.getReport(sessionId, userId);
  },
  validateRequestId(value: string | null) { if (!value || !UUID.test(value)) throw new AiPipelineError(400, "INVALID_IDEMPOTENCY_KEY"); return value; },
  async deleteSession(sessionId:string,userId:string,requestId:string){
    const session=await coachSessionService.getSession(sessionId,userId); if(!session)throw new AiPipelineError(404,"SESSION_NOT_FOUND");
    const prefix=`supabase://${getAppConfig().video.bucket}/`; const path=session.take.videoUrl?.startsWith(prefix)?session.take.videoUrl.slice(prefix.length):null;
    await repository.beginDelete({sessionId,userId,requestId});
    let storageDeleted=false;
    try{const admin=createSupabaseAdminClient();if(!admin||!path)throw new Error("storage");const removed=await admin.storage.from(getAppConfig().video.bucket).remove([path]);if(removed.error)throw new Error("storage");await repository.recordStorageDeleted({sessionId,userId,requestId});storageDeleted=true;await repository.completeDelete({sessionId,userId,requestId});return{requestId,status:"completed" as const};}
    catch{const code=storageDeleted?"DELETE_ROWS_FAILED":"DELETE_STORAGE_FAILED";await repository.failDelete({sessionId,userId,requestId,safeErrorCode:code});throw new AiPipelineError(503,code)}
  },
  async getDeletionStatus(sessionId:string,userId:string,requestId:string){const value=await repository.findDeletionAttempt(sessionId,userId,requestId);if(!value)throw new AiPipelineError(404,"DELETION_NOT_FOUND");return value;},
};
