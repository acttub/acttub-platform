import { createAiPipelineExecutionCore, AiPipelineCoreError, assertTerminalAtConversationLimit, interviewProgress, sanitizePublicAiPipelineAggregate } from "./ai-pipeline-execution-core.js";
import { fingerprintJson } from "./ai-pipeline-fingerprint.js";
import { countReportableActorTurns, validateInterviewCompletionCount } from "./ai-pipeline-runtime-rules.js";
import { settleAgentClaimProgress } from "./agent-claim-settlement.js";
import { normalizeOptionalNote, optionalNoteLength } from "../lib/optional-note.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unknownAnswers = new Set(["모르겠어요", "잘 모르겠어요", "unknown"]);
const correctionOnlyState = "rejected";
const executionCoreFor = (deps, sessionId, userId) => createAiPipelineExecutionCore({
    claimRun: async () => {
        throw new AiPipelineError(503, "EXECUTION_CORE_CLAIM_RUN_UNUSED");
    },
    readRun: async (runId) => {
        const committed = await deps.repository.findPipelineSessionForOwner(sessionId, userId);
        if (!committed)
            throw new AiPipelineError(404, "PIPELINE_SESSION_NOT_FOUND");
        const run = committed.runs.find((item) => item.id === runId);
        if (!run)
            throw new AiPipelineError(404, "AI_RUN_NOT_FOUND");
        return { owned: false, run };
    },
});
export class AiPipelineError extends Error {
    status;
    code;
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
        this.name = "AiPipelineError";
    }
}
export const createAiPipelineService = (incomingDeps) => {
    const deps = Object.freeze({ ...incomingDeps });
    const isAiServiceError = deps.isAiServiceError ?? ((error) => error instanceof Error && typeof error.code === "string" && typeof error.retryable === "boolean");
    const isPersistenceError = deps.isPersistenceError ?? ((error) => error instanceof Error && typeof error.field === "string");
    const createSummaryNetworkError = deps.createSummaryNetworkError ?? (() => Object.assign(new Error("NETWORK_ERROR"), { stage: "summary", code: "NETWORK_ERROR", status: null, retryable: true }));
    const runExecution = async (core, input) => {
        try { return await core.run(input); }
        catch (error) {
            if (error instanceof AiPipelineCoreError) {
                const status = error.code === "AI_INVALID_RESPONSE" ? 502
                    : ["AI_TIMEOUT", "AI_UNAVAILABLE", "AI_INTERNAL", "TURN_PERSISTENCE_FAILED", "SUMMARY_PERSISTENCE_FAILED", "REPORT_PERSISTENCE_FAILED", "AI_RUN_COMMIT_NOT_OBSERVED"].includes(error.code) ? 503
                    : error.status === 503 ? 503 : error.status === 502 ? 502 : 409;
                throw new AiPipelineError(status, error.code);
            }
            throw error;
        }
    };
    const aggregate = async (sessionId, userId) => {
        const value = await deps.repository.findPipelineSessionForOwner(sessionId, userId);
        if (!value)
            throw new AiPipelineError(404, "PIPELINE_SESSION_NOT_FOUND");
        return value;
    };
    const publicAggregate = (value) => {
        if (!(value.optionalNote === null || typeof value.optionalNote === "string"))
            throw new AiPipelineError(503, "OPTIONAL_NOTE_PROJECTION_INVALID");
        return sanitizePublicAiPipelineAggregate({
        ...value, optionalNote: value.optionalNote,
        observations: value.observations.filter((item) => item.priority !== null && item.priority <= 3),
        });
    };
    const currentInput = (command, extras = {}) => ({
        command,
        answer: null,
        answerTurnId: null,
        observationId: null,
        ...extras,
    });
    const actorTurnCount = (session) => countReportableActorTurns(session.transcript);
    const providerTranscript = (session) => session.transcript
        .filter((item) => item.kind !== "optional_note")
        .map((item) => ({ turnId: item.id, speaker: item.role, content: item.content, kind: item.kind }));
    const sortedCorrections = (session) => [...session.corrections].sort((left, right) => left.correctionByTurnId.localeCompare(right.correctionByTurnId) || left.id.localeCompare(right.id));
    const ensureMutableInterviewSession = (session) => {
        if (session.interviewStatus === "completed" || session.interviewStatus === "completed_without_report")
            throw new AiPipelineError(409, "SESSION_NOT_MUTABLE");
    };
    const agentRequest = (session, runId, input) => {
        if (!session.summary)
            throw new AiPipelineError(409, "SUMMARY_NOT_READY");
        return {
            schemaVersion: "agent-turn.v1",
            sessionId: session.sessionId,
            runId,
            normalizedSummary: session.summary.normalizedSummary,
            observations: session.observations
                .filter((item) => item.priority !== null && item.priority <= 3)
                .map((item) => ({ observationId: item.id, segment: { startMs: item.startMs, endMs: item.endMs }, text: item.text, confirmationState: item.confirmationState, blocked: item.blockedForQuestioning, confidence: null, priority: item.priority ?? 3, dimension: item.dimension ?? "general", severity: item.severity })),
            actorCorrections: session.corrections.map((item) => ({ correctionId: item.id, correctsObservationId: item.correctsObservationId, segment: item.segment, text: item.text, actorTurnId: item.correctionByTurnId })),
            transcript: providerTranscript(session),
            substantiveAnswerCount: session.substantiveAnswerCount,
            currentInput: input,
        };
    };
    const failRun = async (sessionId, userId, runId, error) => {
        const safeErrorCode = isAiServiceError(error)
            ? error.code === "TIMEOUT" ? "AI_TIMEOUT" : error.code === "INVALID_RESPONSE" || error.code === "CORRELATION_MISMATCH" ? "AI_INVALID_RESPONSE" : error.retryable ? "AI_UNAVAILABLE" : "AI_INTERNAL"
            : "AI_INTERNAL";
        const retryable = safeErrorCode === "AI_TIMEOUT" || safeErrorCode === "AI_UNAVAILABLE";
        await deps.repository.failRun({ sessionId, userId, runId, safeErrorCode, retryable });
        throw new AiPipelineError(retryable || safeErrorCode === "AI_INTERNAL" ? 503 : 502, safeErrorCode);
    };
    const claimRun = async (input) => {
        try {
            return await deps.repository.claimRun(input);
        }
        catch (error) {
            if (isPersistenceError(error) && error.field === "request_payload_conflict") {
                throw new AiPipelineError(409, "REQUEST_PAYLOAD_CONFLICT");
            }
            throw error;
        }
    };
    const summaryClaimPayload = (session) => ({
        schemaVersion: "summary-request.v1",
        sessionId: session.sessionId,
        storageBucket: session.take.storageBucket,
        storagePath: session.take.storagePath,
        durationMs: session.take.durationMs,
        sceneContext: session.sceneContext,
    });
    const agentClaimPayload = (session, input, requestId, expectedSubstantiveAnswerCount, expectedTotalConversationCount) => ({
        schemaVersion: "agent-turn.v1",
        sessionId: session.sessionId,
        command: input.command,
        requestId,
        answer: input.answer,
        observationId: input.observationId,
        expectedSubstantiveAnswerCount,
        expectedTotalConversationCount,
    });
    const isAgentReplayPayload = (value) => value !== null && "actorTurn" in value && "agentTurn" in value && "done" in value && "reportEvidence" in value;
    const isReportReplayPayload = (value) => value !== null && "schemaVersion" in value && value.schemaVersion === "report.v1" && "sections" in value && "runId" in value;
    const isReportSection = (value) => typeof value === "object" && value !== null && "status" in value && "content" in value && "observationEvidenceIds" in value && "turnEvidenceIds" in value && "timestampRange" in value;
    const isNormalizedSummary = (value) => typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === "scene-summary.v1" && "summary" in value && "observation" in value && "anomalies" in value;
    const requireObservationIds = (value) => {
        if (typeof value !== "object" || value === null || !("observationIds" in value) || !Array.isArray(value.observationIds) || !value.observationIds.every((item) => typeof item === "string")) {
            throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
        }
        return value.observationIds;
    };
    const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const requestBody = (value) => {
        if (!isRecord(value))
            throw new AiPipelineError(400, "INVALID_REQUEST_BODY");
        return value;
    };
    const isCompletionReason = (value) => typeof value === "string" && ["interview_complete_report_ready", "manual_stop_report_ready", "manual_stop_paused", "hard_limit_report_ready", "insufficient_confirmed_evidence", "insufficient_interview_evidence"].includes(value);
    const isAgentTransportResponse = (value) => "action" in value && "completionReason" in value && "model" in value && "promptVersion" in value;
    const requireAgentTransportResponse = (value) => {
        if (!isAgentTransportResponse(value))
            throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
        return value;
    };
    const isReportReadyReason = (value) => value === "interview_complete_report_ready" || value === "manual_stop_report_ready" || value === "hard_limit_report_ready";
    const requireReportEvidence = (value) => {
        if (typeof value !== "object" || value === null || !("observationIds" in value) || !("answerTurnIds" in value) || !Array.isArray(value.observationIds) || !Array.isArray(value.answerTurnIds) || !value.observationIds.every((item) => typeof item === "string") || !value.answerTurnIds.every((item) => typeof item === "string")) {
            throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
        }
        return { observationIds: value.observationIds, answerTurnIds: value.answerTurnIds };
    };
    const replayCommittedAgentOutcome = (session, committedRun) => {
        const response = isAgentReplayPayload(committedRun.responsePayload) ? committedRun.responsePayload : null;
        if (!response)
            throw new AiPipelineError(503, "AGENT_RESPONSE_PAYLOAD_MISSING");
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
    const reportClaimPayload = (session) => ({
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
        actorCorrections: sortedCorrections(session).map((item) => ({
            correctionId: item.id,
            correctsObservationId: item.correctsObservationId,
            segment: item.segment,
            text: item.text,
            actorTurnId: item.correctionByTurnId,
        })),
        transcript: providerTranscript(session),
        completionReason: session.completionReason,
        selectedEvidence: {
            observationIds: session.reportEvidenceObservationIds,
            answerTurnIds: session.reportEvidenceAnswerTurnIds,
        },
    });
    const requireReportTransportResponse = (value) => {
        if (typeof value.sections !== "object" || value.sections === null)
            throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
        const sections = value.sections;
        if (!("oneLineSummary" in sections) || !isReportSection(sections.oneLineSummary) || !("primaryReviewPoint" in sections) || !isReportSection(sections.primaryReviewPoint) || !("confirmedEvidence" in sections) || !isReportSection(sections.confirmedEvidence) || !("actorDiscovery" in sections) || !isReportSection(sections.actorDiscovery) || !("groundedEncouragement" in sections) || !isReportSection(sections.groundedEncouragement) || !("nextPracticeStep" in sections) || !isReportSection(sections.nextPracticeStep))
            throw new AiPipelineError(502, "AI_INVALID_RESPONSE");
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
    const reportExecutionResult = (report, response = null) => ({ report, response });
    const generateReport = async (session, userId, idempotencyKey, maxAttempts) => {
        await deps.requireCurrentAiProcessingConsent(userId);
        if (session.report)
            return session.report;
        if (!session.summary || !session.completionReason?.endsWith("_report_ready"))
            throw new AiPipelineError(409, "REPORT_NOT_READY");
        const summary = session.summary;
        const proposedRunId = crypto.randomUUID();
        const core = executionCoreFor(deps, session.sessionId, userId);
        const result = await runExecution(core, {
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
            invoke: async (run) => {
                const confirmed = session.observations.filter((item) => session.reportEvidenceObservationIds.includes(item.id));
                const request = {
                    schemaVersion: "report-request.v1",
                    sessionId: session.sessionId,
                    runId: run.id,
                    normalizedSummary: summary.normalizedSummary,
                    confirmedObservations: confirmed.map((item) => {
                        if (!item.candidateId || !item.dimension)
                            throw new AiPipelineError(409, "REPORT_EVIDENCE_INVALID");
                        return { observationId: item.id, sourceCandidateId: item.candidateId, segment: { startMs: item.startMs, endMs: item.endMs }, text: item.text, dimension: item.dimension };
                    }),
                    actorCorrections: sortedCorrections(session).map((item) => ({ correctionId: item.id, correctsObservationId: item.correctsObservationId, segment: item.segment, text: item.text, actorTurnId: item.correctionByTurnId })),
                    transcript: providerTranscript(session),
                    completionReason: isReportReadyReason(session.completionReason) ? session.completionReason : (() => { throw new AiPipelineError(409, "REPORT_NOT_READY"); })(),
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
            replay: (run) => {
                if (!isReportReplayPayload(run.responsePayload))
                    throw new AiPipelineError(503, "REPORT_RESPONSE_PAYLOAD_MISSING");
                return reportExecutionResult(session.report, { sections: run.responsePayload.sections, model: run.responsePayload.model, promptVersion: run.responsePayload.promptVersion });
            },
            recover: async (_error, run) => {
                const committed = await aggregate(session.sessionId, userId);
                const committedRun = committed.runs.find((item) => item.id === run.id && item.stage === "report" && item.status === "completed");
                if (committedRun && committed.report?.sourceRunId === run.id)
                    return reportExecutionResult(committed.report);
                return null;
            },
            providerFailure: async (error, run) => {
                if (error instanceof AiPipelineError) {
                    if (error.code === "STALE_INTERVIEW_PROGRESS" || error.code === "TURN_PERSISTENCE_FAILED")
                        throw error;
                    await deps.repository.failRun({ sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "AI_INVALID_RESPONSE", retryable: false });
                    throw error;
                }
                return failRun(session.sessionId, userId, run.id, error);
            },
            persistenceFailure: async (_error, run) => {
                try {
                    await deps.repository.failRun({ sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "REPORT_PERSISTENCE_FAILED", retryable: true });
                }
                catch { /* a committed run rejects running-only cleanup */ }
                throw new AiPipelineError(503, "REPORT_PERSISTENCE_FAILED");
            },
        });
        if (result?.report)
            return result.report;
        try {
            const committed = await aggregate(session.sessionId, userId);
            if (committed.report)
                return committed.report;
        }
        catch { /* immutable report fallback below */ }
        try {
            const existing = await deps.repository.findImmutableReport(session.sessionId, userId);
            if (existing)
                return existing;
        }
        catch { /* safe persistence boundary below */ }
        throw new AiPipelineError(503, "REPORT_PERSISTENCE_FAILED");
    };
    const latestCompletedAgentRun = (session) => [...session.runs]
        .filter((run) => run.stage === "agent" && run.status === "completed" && run.responseSchemaVersion === "agent-turn.v1" && Boolean(run.model?.trim()) && run.promptVersion === "acting-agent.prompt.v2" && isAgentReplayPayload(run.responsePayload) && run.responsePayload.done && run.responsePayload.reportReady && run.responsePayload.completionReason !== null && run.responsePayload.completionReason.endsWith("_report_ready"))
        .sort((a, b) => (a.completedAt ?? a.startedAt ?? "").localeCompare(b.completedAt ?? b.startedAt ?? "") || a.attempt - b.attempt || a.id.localeCompare(b.id))
        .at(-1) ?? null;
    const callAgent = async (session, userId, input, expectedSubstantiveAnswerCount = session.substantiveAnswerCount, expectedTotalConversationCount = actorTurnCount(session), requestId = session.sessionId) => {
        await deps.requireCurrentAiProcessingConsent(userId);
        if (!UUID.test(requestId) || !Number.isInteger(expectedSubstantiveAnswerCount) || expectedSubstantiveAnswerCount < 0 || !Number.isInteger(expectedTotalConversationCount) || expectedTotalConversationCount < 0 || expectedSubstantiveAnswerCount > expectedTotalConversationCount || expectedTotalConversationCount > 10)
            throw new AiPipelineError(400, "INVALID_INTERVIEW_TURN");
        const runId = crypto.randomUUID();
        const requestPayload = agentClaimPayload(session, input, requestId, expectedSubstantiveAnswerCount, expectedTotalConversationCount);
        const core = executionCoreFor(deps, session.sessionId, userId);
        const result = await runExecution(core, {
            claim: async () => settleAgentClaimProgress({ claimed: await claimRun({
                    sessionId: session.sessionId,
                    userId,
                    stage: "agent",
                    runId,
                    idempotencyKey: input.command === "answer" && requestId ? `answer:${requestId}` : `${input.command}:${session.substantiveAnswerCount}:${expectedTotalConversationCount}`,
                    maxAttempts: 2,
                    requestSchemaVersion: "agent-turn.v1",
                    requestPayloadFingerprint: fingerprintJson(requestPayload),
                    model: "agent",
                    promptVersion: "acting-agent.prompt.v2",
                }), readAggregate: () => aggregate(session.sessionId, userId), failRun: (claimedRunId) => deps.repository.failRun({ sessionId: session.sessionId, userId, runId: claimedRunId, safeErrorCode: "AI_INTERNAL", retryable: false }), expectedSubstantiveAnswerCount, expectedTotalConversationCount, actorTurnCount, staleError: () => new AiPipelineError(409, "STALE_INTERVIEW_PROGRESS"), persistenceError: () => new AiPipelineError(503, "TURN_PERSISTENCE_FAILED") }),
            invoke: async (run) => {
                const authoritativeSession = await aggregate(session.sessionId, userId);
                if (authoritativeSession.substantiveAnswerCount !== expectedSubstantiveAnswerCount || actorTurnCount(authoritativeSession) !== expectedTotalConversationCount) {
                    const stale = new AiPipelineError(409, "STALE_INTERVIEW_PROGRESS");
                    const cleanup = { sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "AI_INTERNAL", retryable: false };
                    const terminalObserved = async () => {
                        try {
                            const observed = await aggregate(session.sessionId, userId);
                            const observedRun = observed.runs.find((candidate) => candidate.id === run.id);
                            return Boolean(observedRun && observedRun.status !== "running" && observedRun.status !== "pending");
                        }
                        catch {
                            return false;
                        }
                    };
                    try {
                        await deps.repository.failRun(cleanup);
                        throw stale;
                    }
                    catch (error) {
                        if (error === stale || await terminalObserved())
                            throw stale;
                    }
                    try {
                        await deps.repository.failRun(cleanup);
                    }
                    catch { /* authoritative reload below decides whether cleanup committed */ }
                    if (await terminalObserved())
                        throw stale;
                    throw new AiPipelineError(503, "TURN_PERSISTENCE_FAILED");
                }
                if (expectedTotalConversationCount >= 10)
                    throw new AiPipelineError(409, "SESSION_NOT_MUTABLE");
                const actorTurn = input.command === "answer" && input.answer
                    ? { id: crypto.randomUUID(), sequence: authoritativeSession.transcript.length, role: "actor", kind: unknownAnswers.has(input.answer) ? "unknown" : "answer", content: input.answer, questionFocus: null, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: [], reportEvidenceSelected: false }
                    : null;
                const persistedInput = actorTurn ? { ...input, answerTurnId: actorTurn.id } : input;
                const requestSession = actorTurn
                    ? {
                        ...authoritativeSession,
                        transcript: [...authoritativeSession.transcript, actorTurn],
                        substantiveAnswerCount: authoritativeSession.substantiveAnswerCount + (actorTurn.kind === "answer" ? 1 : 0),
                    }
                    : authoritativeSession;
                const request = agentRequest(requestSession, run.id, persistedInput);
                await deps.requireCurrentAiProcessingConsent(userId);
                const response = await deps.createAiTransport(deps.loadAiServiceConfig()).agent(request);
                const action = String(response.action);
                const done = response.done === true;
                const completionReason = response.completionReason === null ? null : isCompletionReason(response.completionReason) ? response.completionReason : (() => { throw new AiPipelineError(502, "AI_INVALID_RESPONSE"); })();
                const reportReady = response.reportReady === true;
                const progress = interviewProgress(requestSession.transcript);
                const lastTwoReportableKinds = requestSession.transcript.filter((turn) => turn.role === "actor" && (turn.kind === "answer" || turn.kind === "unknown")).slice(-2).map((turn) => turn.kind);
                validateInterviewCompletionCount({ reason: completionReason, substantiveAnswerCount: progress.substantiveAnswerCount, reportableActorCount: progress.totalReportableActorCount, lastTwoReportableKinds, fail: () => { throw new AiPipelineError(502, "AI_INVALID_RESPONSE"); } });
                assertTerminalAtConversationLimit({ actual: progress, done, reportReady, completionReason, fail: () => { throw new AiPipelineError(502, "AI_INVALID_RESPONSE"); } });
                const reportEvidence = requireReportEvidence(response.reportEvidence);
                if (actorTurn)
                    actorTurn.reportEvidenceSelected = actorTurn.kind === "answer" && reportEvidence.answerTurnIds.includes(actorTurn.id);
                const agentTurn = { id: crypto.randomUUID(), sequence: authoritativeSession.transcript.length + (actorTurn ? 1 : 0), role: "agent", kind: done ? "closing" : "question", content: String(response.utterance), questionFocus: done ? null : action, groundingStartMs: null, groundingEndMs: null, sourceObservationIds: requireObservationIds(response.evidence), reportEvidenceSelected: false };
                const responsePayload = { actorTurn, agentTurn, done, completionReason, reportReady, reportEvidence };
                return { report: null, response: responsePayload, transportResponse: requireAgentTransportResponse(response), claimedRunId: run.id, persistedInput, actorTurn, agentTurn, done, completionReason, reportReady, reportEvidence };
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
                if (committedRun)
                    return { ...replayCommittedAgentOutcome(committed, committedRun), transportResponse: null, claimedRunId: committedRun.id, persistedInput: input };
                return null;
            },
            providerFailure: async (error, run) => {
                if (error instanceof AiPipelineError) {
                    if (error.code === "STALE_INTERVIEW_PROGRESS" || error.code === "TURN_PERSISTENCE_FAILED")
                        throw error;
                    await deps.repository.failRun({ sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "AI_INVALID_RESPONSE", retryable: false });
                    throw error;
                }
                return failRun(session.sessionId, userId, run.id, error);
            },
            persistenceFailure: async (_error, run) => {
                try {
                    await deps.repository.failRun({ sessionId: session.sessionId, userId, runId: run.id, safeErrorCode: "TURN_PERSISTENCE_FAILED", retryable: true });
                }
                catch { /* a committed run rejects running-only cleanup */ }
                throw new AiPipelineError(503, "TURN_PERSISTENCE_FAILED");
            },
        });
        const { transportResponse: _transportResponse, claimedRunId, persistedInput: _persistedInput, response: _response, ...publicResult } = result;
        if (publicResult.reportReady && !publicResult.report) {
            const report = await generateReport(await aggregate(session.sessionId, userId), userId, `report:${claimedRunId}`, 2);
            return { ...publicResult, report };
        }
        return publicResult;
    };
    return Object.freeze({
        async createSession(body, userId) {
            const input = requestBody(body);
            const required = (key) => { const value = input[key]; if (typeof value !== "string" || !value.trim())
                throw new AiPipelineError(400, "INVALID_PIPELINE_SESSION"); return value.trim(); };
            const allowed = new Set(["sessionId", "uploadIntentId", "storagePath", "genre", "situation", "characterContext", "subtext"]);
            if (Object.keys(input).some((key) => !allowed.has(key)))
                throw new AiPipelineError(400, "INVALID_PIPELINE_SESSION");
            const sessionId = required("sessionId"), uploadIntentId = required("uploadIntentId"), storagePath = required("storagePath"), genre = required("genre"), situation = required("situation"), characterContext = required("characterContext"), subtext = typeof input.subtext === "string" && input.subtext.trim() ? input.subtext.trim() : null;
            await deps.requireCurrentAiProcessingConsent(userId);
            const consent = await deps.getCurrentConsentVersions();
            const upload = await deps.repository.findEligibleUpload(uploadIntentId, userId);
            if (!upload || upload.sessionId !== sessionId || upload.storagePath !== storagePath || upload.requiredConsentVersionSnapshot !== consent.requiredConsentVersion || upload.aiProcessingConsentVersionSnapshot !== consent.aiProcessingConsentVersion)
                throw new AiPipelineError(409, "UPLOAD_NOT_AI_ELIGIBLE");
            const takeId = crypto.randomUUID();
            await deps.repository.createPipelineSession({ uploadIntentId, userId, sessionId, takeId, payload: { medium: "upload_url", genre, situation, characterContext, subtext } });
            const persisted = await aggregate(sessionId, userId);
            const proposedRunId = crypto.randomUUID();
            const core = executionCoreFor(deps, sessionId, userId);
            const result = await runExecution(core, {
                claim: () => claimRun({ sessionId, userId, stage: "summary", runId: proposedRunId, idempotencyKey: `summary:${uploadIntentId}`, maxAttempts: 2, requestSchemaVersion: "summary-request.v1", requestPayloadFingerprint: fingerprintJson(summaryClaimPayload(persisted)), model: "summary", promptVersion: "acting-summary.prompt.v2" }),
                invoke: async (run) => { await deps.requireCurrentAiProcessingConsent(userId); const admin = deps.createSupabaseAdminClient(); if (!admin)
                    throw new AiPipelineError(503, "SIGNED_VIDEO_UNAVAILABLE"); const signed = await admin.storage.from(persisted.take.storageBucket).createSignedUrl(persisted.take.storagePath, deps.getAppConfig().video.signedUrlExpiresInSeconds); if (signed.error || !signed.data?.signedUrl)
                    throw createSummaryNetworkError(); const request = { schemaVersion: "summary-request.v1", sessionId, runId: run.id, signedVideoUrl: signed.data.signedUrl, storageBucket: persisted.take.storageBucket, storagePath: persisted.take.storagePath, durationMs: persisted.take.durationMs, sceneContext: persisted.sceneContext }; await deps.requireCurrentAiProcessingConsent(userId); return { session: persisted, summaryRun: run, response: await deps.createAiTransport(deps.loadAiServiceConfig()).summary(request) }; },
                persist: async (invoked, run) => { const response = invoked.response; if (!response || !Array.isArray(response.observationCandidates) || !isNormalizedSummary(response.normalizedSummary))
                    throw new AiPipelineError(502, "AI_INVALID_RESPONSE"); const candidates = response.observationCandidates.map((value) => { if (typeof value !== "object" || value === null)
                    throw new AiPipelineError(502, "AI_INVALID_RESPONSE"); const item = Object.fromEntries(Object.entries(value)); const severity = item.severity === null ? null : item.severity === "high" || item.severity === "mid" || item.severity === "low" ? item.severity : (() => { throw new AiPipelineError(502, "AI_INVALID_RESPONSE"); })(); return { id: String(item.candidateId), startMs: Number(item.timestampStartMs), endMs: Number(item.timestampEndMs), text: String(item.observationText), priority: Number(item.priority), dimension: String(item.dimension), severity }; }); await deps.repository.completeSummaryRun({ sessionId, userId, runId: run.id, normalizedSummary: response.normalizedSummary, candidates, model: String(response.model), promptVersion: String(response.promptVersion) }); },
                replay: () => { throw new AiPipelineError(503, "SUMMARY_RELOAD_REQUIRED"); },
                recover: async (_error, run) => { const committed = await aggregate(sessionId, userId); const summaryRun = committed.runs.find(item => item.id === run.id && item.stage === "summary" && item.status === "completed"); return summaryRun && committed.summary?.sourceRunId === run.id ? { session: committed, summaryRun, response: null } : null; },
                providerFailure: (error, run) => failRun(sessionId, userId, run.id, error),
                persistenceFailure: async (_error, run) => { try {
                    await deps.repository.failRun({ sessionId, userId, runId: run.id, safeErrorCode: "SUMMARY_PERSISTENCE_FAILED", retryable: true });
                }
                catch { /* a committed run rejects running-only cleanup */ } throw new AiPipelineError(503, "SUMMARY_PERSISTENCE_FAILED"); },
            });
            const refreshed = result.response ? await aggregate(sessionId, userId) : result.session;
            const summaryRun = refreshed.runs.find(run => run.id === result.summaryRun.id) ?? result.summaryRun;
            return { session: publicAggregate(refreshed), summaryRun: sanitizePublicAiPipelineAggregate(summaryRun) };
        },
        async getSession(sessionId, userId) { return publicAggregate(await aggregate(sessionId, userId)); },
        async saveOptionalNote(sessionId, userId, body) {
            const payload = requestBody(body);
            if (Object.keys(payload).length !== 1 || !("content" in payload) || !(payload.content === null || typeof payload.content === "string"))
                throw new AiPipelineError(400, "INVALID_OPTIONAL_NOTE");
            const session = await aggregate(sessionId, userId);
            const terminal = (session.interviewStatus === "completed" && ["interview_complete_report_ready", "manual_stop_report_ready", "hard_limit_report_ready"].includes(session.completionReason))
                || (session.interviewStatus === "completed_without_report" && ["insufficient_confirmed_evidence", "insufficient_interview_evidence"].includes(session.completionReason));
            if (!terminal)
                throw new AiPipelineError(409, "OPTIONAL_NOTE_NOT_ALLOWED");
            const content = typeof payload.content === "string" ? normalizeOptionalNote(payload.content) : null;
            if (content !== null && optionalNoteLength(content) > 1000)
                throw new AiPipelineError(400, "INVALID_OPTIONAL_NOTE");
            try {
                await deps.repository.saveOptionalNote({ sessionId, userId, turnId: crypto.randomUUID(), content });
            }
            catch (error) {
                if (isPersistenceError(error))
                    throw new AiPipelineError(503, "OPTIONAL_NOTE_PERSISTENCE_FAILED");
                throw error;
            }
            const refreshed = await aggregate(sessionId, userId);
            if (!(refreshed.optionalNote === null || typeof refreshed.optionalNote === "string"))
                throw new AiPipelineError(503, "OPTIONAL_NOTE_PROJECTION_INVALID");
            return { optionalNote: refreshed.optionalNote };
        },
        async confirmObservation(sessionId, observationId, userId, body) {
            const session = await aggregate(sessionId, userId);
            const payload = requestBody(body);
            if (!session.observations.some((item) => item.id === observationId && item.priority !== null && item.priority <= 3))
                throw new AiPipelineError(404, "OBSERVATION_NOT_FOUND");
            ensureMutableInterviewSession(session);
            if (payload.state !== "accepted" && payload.state !== correctionOnlyState && payload.state !== "unsure")
                throw new AiPipelineError(400, "INVALID_CONFIRMATION");
            if (payload.correction !== undefined && (payload.state !== correctionOnlyState || typeof payload.correction !== "string" || !payload.correction.trim()))
                throw new AiPipelineError(400, "INVALID_CONFIRMATION");
            await deps.repository.confirmObservation({ sessionId, userId, observationId, state: payload.state, correction: typeof payload.correction === "string" ? { id: crypto.randomUUID(), turnId: crypto.randomUUID(), text: payload.correction.trim() } : null });
            return this.getSession(sessionId, userId);
        },
        async startInterview(sessionId, userId) {
            const session = await aggregate(sessionId, userId);
            if (session.interviewStatus === "completed_without_report" && session.completionReason === "insufficient_confirmed_evidence")
                return { done: true, completionReason: "insufficient_confirmed_evidence", reportReady: false };
            if (!session.observations.some((item) => item.confirmationState === "accepted" && !item.blockedForQuestioning)) {
                await deps.repository.completeInterview({ sessionId, userId, status: "completed_without_report", completionReason: "insufficient_confirmed_evidence", observationIds: [], answerTurnIds: [] });
                return { done: true, completionReason: "insufficient_confirmed_evidence", reportReady: false };
            }
            return callAgent(session, userId, currentInput("start"));
        },
        async addTurn(sessionId, userId, body) {
            const payload = requestBody(body);
            if (typeof payload.answer !== "string" || !payload.answer.trim() || !Number.isInteger(payload.expectedSubstantiveAnswerCount) || !Number.isInteger(payload.expectedTotalConversationCount) || typeof payload.requestId !== "string" || !UUID.test(payload.requestId))
                throw new AiPipelineError(400, "INVALID_INTERVIEW_TURN");
            const session = await aggregate(sessionId, userId);
            const answer = payload.answer.trim();
            return callAgent(session, userId, currentInput("answer", { answer }), Number(payload.expectedSubstantiveAnswerCount), Number(payload.expectedTotalConversationCount), payload.requestId);
        },
        async stopInterview(sessionId, userId) { const session = await aggregate(sessionId, userId); return callAgent(session, userId, currentInput("manual_stop")); },
        async resumeInterview(sessionId, userId) { const session = await aggregate(sessionId, userId); return callAgent(session, userId, currentInput("resume")); },
        async getReport(sessionId, userId) { const session = await aggregate(sessionId, userId); if (!session.report)
            throw new AiPipelineError(404, "REPORT_NOT_FOUND"); return session.report; },
        async retryReport(sessionId, userId) {
            const session = await aggregate(sessionId, userId);
            if (session.report)
                return session.report;
            const failed = [...session.runs].filter((run) => run.stage === "report" && run.status === "failed" && run.retryable).sort((a, b) => (a.completedAt ?? a.startedAt ?? "").localeCompare(b.completedAt ?? b.startedAt ?? "") || a.attempt - b.attempt || a.id.localeCompare(b.id)).at(-1);
            const running = [...session.runs].filter((run) => run.stage === "report" && run.status === "running").sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "") || a.attempt - b.attempt || a.id.localeCompare(b.id)).at(-1);
            const terminalAgentRun = latestCompletedAgentRun(session);
            if (!session.summary || !session.completionReason?.endsWith("_report_ready") || !terminalAgentRun)
                throw new AiPipelineError(409, "REPORT_NOT_RETRYABLE");
            const idempotencyKey = `report:${terminalAgentRun.id}`;
            if ((failed && failed.idempotencyKey !== idempotencyKey) || (running && running.idempotencyKey !== idempotencyKey))
                throw new AiPipelineError(409, "REPORT_NOT_RETRYABLE");
            return generateReport(session, userId, idempotencyKey, failed?.maxAttempts ?? running?.maxAttempts ?? 2);
        },
        validateRequestId(value) { if (!value || !UUID.test(value))
            throw new AiPipelineError(400, "INVALID_IDEMPOTENCY_KEY"); return value; },
        async deleteSession(sessionId, userId, requestId) {
            const previous = await deps.repository.findDeletionAttempt(sessionId, userId, requestId);
            if (previous?.status === "completed")
                return { requestId, status: "completed" };
            const session = await deps.coachSessionService.getSessionIncludingHidden(sessionId, userId);
            if (!session)
                throw new AiPipelineError(404, "SESSION_NOT_FOUND");
            const prefix = `supabase://${deps.getAppConfig().video.bucket}/`;
            const path = session.take.videoUrl?.startsWith(prefix) ? session.take.videoUrl.slice(prefix.length) : null;
            await deps.repository.beginDelete({ sessionId, userId, requestId });
            const existingAttempt = await deps.repository.findDeletionAttempt(sessionId, userId, requestId);
            let storageDeleted = existingAttempt?.storageDeleted === true;
            if (storageDeleted) {
                try {
                    await deps.repository.completeDelete({ sessionId, userId, requestId });
                    return { requestId, status: "completed" };
                }
                catch {
                    await deps.repository.failDelete({ sessionId, userId, requestId, safeErrorCode: "DELETE_ROWS_FAILED" });
                    throw new AiPipelineError(503, "DELETE_ROWS_FAILED");
                }
            }
            try {
                const admin = deps.createSupabaseAdminClient();
                if (!admin || !path)
                    throw new Error("storage");
                const bucket = admin.storage.from(deps.getAppConfig().video.bucket);
                const removed = await bucket.remove([path]);
                if (removed.error)
                    throw new Error("storage");
                const parts = path.split("/"), name = parts.pop(), directory = parts.join("/");
                const verification = await bucket.list(directory, { limit: 100, search: name });
                if (verification.error || verification.data?.some((item) => item.name === name)) {
                    await deps.repository.failDelete({ sessionId, userId, requestId, safeErrorCode: "DELETE_VERIFICATION_FAILED" });
                    throw new AiPipelineError(503, "DELETE_VERIFICATION_FAILED");
                }
                await deps.repository.recordStorageDeleted({ sessionId, userId, requestId });
                storageDeleted = true;
                await deps.repository.completeDelete({ sessionId, userId, requestId });
                return { requestId, status: "completed" };
            }
            catch (error) {
                if (error instanceof AiPipelineError)
                    throw error;
                const code = storageDeleted ? "DELETE_ROWS_FAILED" : "DELETE_STORAGE_FAILED";
                await deps.repository.failDelete({ sessionId, userId, requestId, safeErrorCode: code });
                throw new AiPipelineError(503, code);
            }
        },
        async reconcileDeletionAttempts(userId, limit = 25) { const bounded = Math.max(1, Math.min(100, Math.trunc(limit))); const candidates = (await deps.repository.listDeletionReconciliationCandidates(userId)).slice(0, bounded); const results = []; for (const item of candidates) {
            try {
                results.push(await this.deleteSession(item.sessionId, userId, item.requestId));
            }
            catch {
                results.push({ requestId: item.requestId, status: "failed" });
            }
        } return { processed: results.length, results }; },
        async getDeletionStatus(sessionId, userId, requestId) { const value = await deps.repository.findDeletionAttempt(sessionId, userId, requestId); if (!value)
            throw new AiPipelineError(404, "DELETION_NOT_FOUND"); return value; },
    });
};
