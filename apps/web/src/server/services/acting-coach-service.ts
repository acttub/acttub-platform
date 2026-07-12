import "server-only";
import { createHash } from "node:crypto";
import type { ActingCoachSessionDto, ActingReportDto, ActingTurnRequest, CreateActingSessionRequest, RetryAnalysisRequest, SceneGenre, SceneMedium } from "@/lib/api/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { actingApiClient } from "@/server/acting-api/client";
import { getActingApiConfig } from "@/server/acting-api/config";
import { requireCoachResponse, requireRecord, requireReportResponse } from "@/server/acting-api/response-guards";
import { supabaseCoachSessionRepository, type ActingRpcResult } from "@/server/repositories/supabase-coach-session-repository";

type Claim = { kind: "claimed" | "replay_completed" | "replay_failed" | "in_progress" | "outcome_unknown"; operationId: string; leaseToken: string; sessionId: string; runId: string; actorTurnId: string; privateActingSessionId: string; safeErrorCode?: string; source?: Record<string, unknown>; summaryPayload?: unknown; coachContext?: Record<string, unknown>; reportPayload?: unknown; result?: unknown };
const repository = supabaseCoachSessionRepository;
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
function normalizeClaim(value: ActingRpcResult): Claim {
  const source = record(value.analysis_source ?? value.source);
  const coachContext = record(value.coach_context);
  return {
    kind: string(value.kind) as Claim["kind"] ?? value.claimState ?? string(value.claim_state) as Claim["kind"] ?? "claimed",
    operationId: value.operationId ?? string(value.operation_id) ?? "",
    leaseToken: string(value.leaseToken) ?? string(value.lease_token) ?? "",
    sessionId: string(value.sessionId) ?? string(value.session_id) ?? "",
    runId: string(value.runId) ?? string(value.run_id) ?? "",
    actorTurnId: string(value.actorTurnId) ?? string(value.actor_turn_id) ?? "",
    privateActingSessionId: string(value.privateActingSessionId) ?? string(value.acting_session_id) ?? "",
    source: { ...record(value.source), ...source, ...(string(value.actor_text) ? { actorText: string(value.actor_text) } : {}) },
    summaryPayload: value.summaryPayload ?? value.summary_payload,
    coachContext: record(value.coachContext ?? (Object.keys(coachContext).length ? coachContext : undefined)),
    reportPayload: value.reportPayload ?? value.coach_session_payload,
    result: value.result,
    safeErrorCode: string(value.safeErrorCode),
  };
}

export class ActingServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message); this.name = "ActingServiceError"; }
}
const uuid = (value: unknown, field: string) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) ? value.toLowerCase() : (() => { throw new ActingServiceError(400, "validation_error", `${field} must be a UUID.`); })();
export const normalizeContext = (value: unknown, field: string) => { if (typeof value !== "string" || !value.trim()) throw new ActingServiceError(400, "validation_error", `${field} is required.`); return value.trim().replace(/\s+/gu, " "); };
const normalizeReply = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ActingServiceError(400, "validation_error", "text is required.");
  }
  return value.trim();
};
const sceneMediums = new Set<SceneMedium>(["연극", "영화", "TV 드라마", "웹드라마", "뮤지컬", "기타"]);
const sceneGenres = new Set<SceneGenre>(["드라마", "코미디", "로맨스", "스릴러", "액션", "판타지", "기타"]);
const exactEnum = <T extends string>(value: unknown, field: string, allowed: Set<T>): T => {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new ActingServiceError(400, "validation_error", `${field} is invalid.`);
  return value as T;
};
const requireActingConfig = () => {
  try { return getActingApiConfig(); }
  catch { throw new ActingServiceError(503, "acting_api_not_configured", "acting-api is not configured."); }
};
const fingerprint = (values: unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const operationInput = (userId: string, requestId: string, values: unknown[]) => ({ userId, requestId: uuid(requestId, "requestId"), requestFingerprint: fingerprint(["acting-api-v1", ...values]), operationId: crypto.randomUUID(), leaseToken: crypto.randomUUID() });
const replay = (claim: Claim, unknownCode: "analysis_outcome_unknown" | "upstream_outcome_unknown" | "report_outcome_unknown") => {
  if (claim.kind === "in_progress") throw new ActingServiceError(409, "operation_in_progress", "An upstream operation is already in progress.");
  if (claim.kind === "outcome_unknown") throw new ActingServiceError(409, unknownCode, "The upstream outcome is unknown.", { retryAllowed: false });
  if (claim.kind === "replay_failed") {
    const code = claim.safeErrorCode ?? "invalid_session_state";
    const status = code === "acting_api_rate_limited" ? 429 : code === "acting_api_auth_failed" || code === "acting_api_rejected" ? 502 : 409;
    throw new ActingServiceError(status, code, "The prior operation failed.");
  }
  return claim.result;
};
async function json(response: Response, phase: "analysis" | "coach" | "report") { const value = await response.json().catch(() => { throw new ActingServiceError(409, "upstream_outcome_unknown", "The upstream response was invalid.", { causeCode: "acting_api_invalid_response" }); }); if (response.status === 404) throw new ActingServiceError(409, "acting_session_expired", "The acting session expired.", { action: "restart_interview" }); if (response.status === 401) throw new ActingServiceError(502, "acting_api_auth_failed", "acting-api authentication failed."); if (response.status === 429) throw new ActingServiceError(429, "acting_api_rate_limited", "acting-api rate limit exceeded."); if (response.status === 413 && phase === "analysis") throw new ActingServiceError(413, "video_too_large", "The video is too large."); if (response.status === 400 || response.status === 413) throw new ActingServiceError(502, "acting_api_rejected", "acting-api rejected the request."); if (!response.ok) throw new ActingServiceError(409, "upstream_outcome_unknown", "The upstream outcome is unknown.", { causeCode: "acting_api_unavailable" }); return value; }
const ownedSession = async (userId: string, sessionId: string) => { const result = await repository.getOwnedSession(userId, sessionId); if (!result) throw new ActingServiceError(404, "session_not_found", "Session was not found."); if (!("pipelineVersion" in result) || result.pipelineVersion !== "acting-api-v1") throw new ActingServiceError(409, "invalid_session_state", "Legacy sessions are read-only."); return result; };
async function retryLocalCommit(operation: () => Promise<void>) { let last: unknown; for (let attempt = 0; attempt < 3; attempt += 1) { try { await operation(); return; } catch (error) { last = error; } } throw last; }
const asOperationError = (error: unknown, code: "analysis_outcome_unknown" | "upstream_outcome_unknown" | "report_outcome_unknown") => {
  if (error instanceof ActingServiceError) return error;
  const timedOut = error instanceof DOMException && error.name === "TimeoutError";
  return new ActingServiceError(409, code, "The upstream outcome is unknown.", {
    causeCode: timedOut ? "acting_api_timeout" : "acting_api_unavailable",
    retryAllowed: false,
  });
};
async function runAnalysisClaim(claim: Claim, userId: string) {
  const source = claim.source ?? {};
  try {
  const admin = createSupabaseAdminClient(); if (!admin) throw new ActingServiceError(503, "acting_api_not_configured", "Storage transfer is not configured.");
  const signed = await admin.storage.from(String(source.storageBucket)).createSignedUrl(String(source.storagePath), 900); if (signed.error || !signed.data?.signedUrl) throw new ActingServiceError(503, "acting_api_not_configured", "Storage transfer is not configured.");
  const video = await fetch(signed.data.signedUrl); if (!video.ok || !video.body) throw new ActingServiceError(409, "analysis_outcome_unknown", "Video transfer failed.", { causeCode: "acting_api_unavailable", retryAllowed: false, action: "create_new_session" });
  const response = await actingApiClient.summarize({ situation: String(source.formattedSituation), character: String(source.characterContext), subtext: String(source.subtext), video: video.body, fileName: String(source.fileName ?? "take.mp4"), mimeType: String(source.mimeType) }); const summary = requireRecord(await json(response, "analysis")); await retryLocalCommit(() => repository.completeAnalysis({ userId, sessionId: claim.sessionId, operationId: claim.operationId, leaseToken: claim.leaseToken, sceneSummaryId: crypto.randomUUID(), summaryPayload: summary })); return ownedSession(userId, String(claim.sessionId)); } catch (error) { const mapped = asOperationError(error, "analysis_outcome_unknown"); await repository.failAnalysis({ userId, sessionId: claim.sessionId, operationId: claim.operationId, leaseToken: claim.leaseToken, failureClass: mapped.status === 429 || mapped.code === "acting_api_auth_failed" || mapped.code === "video_too_large" ? "definitive" : "ambiguous", safeErrorCode: mapped.code }); throw mapped; }
}

export const actingCoachService = {
  async createSession(payload: unknown, userId: string) {
    const input = payload as CreateActingSessionRequest;
    requireActingConfig();
    const uploadIntentId = uuid(input.uploadIntentId, "uploadIntentId"); const medium = exactEnum(input.medium, "medium", sceneMediums); const genre = exactEnum(input.genre, "genre", sceneGenres); const situation = normalizeContext(input.situation, "situation"); const characterContext = normalizeContext(input.characterContext, "characterContext"); const subtext = normalizeContext(input.subtext, "subtext");
    const claim = normalizeClaim(await repository.createAnalysisClaim({ ...operationInput(userId, input.requestId, ["create", uploadIntentId, medium, genre, situation, characterContext, subtext]), uploadIntentId, sessionId: crypto.randomUUID(), takeId: crypto.randomUUID(), medium, genre, situation, characterContext, subtext, leaseSeconds: 780 }));
    if (claim.kind !== "claimed") return replay(claim, "analysis_outcome_unknown") as ActingCoachSessionDto;
    return runAnalysisClaim(claim, userId);
  },
  async retryAnalysis(sessionId: string, payload: unknown, userId: string) { requireActingConfig(); const input = payload as RetryAnalysisRequest; if (input.operation !== "retry") throw new ActingServiceError(400, "validation_error", "operation must be retry."); const sid = uuid(sessionId, "sessionId"); const claim = normalizeClaim(await repository.claimAnalysisRetry({ ...operationInput(userId, input.requestId, ["analysis_retry", sid]), sessionId: sid, leaseSeconds: 780 })); if (claim.kind !== "claimed") return replay(claim, "analysis_outcome_unknown"); return runAnalysisClaim(claim, userId); },
  async turn(sessionId: string, payload: unknown, userId: string) {
    requireActingConfig();
    const input = payload as ActingTurnRequest; const sid = uuid(sessionId, "sessionId"); const isStart = input.operation === "start" || input.operation === "restart";
    if (isStart) { const claim = normalizeClaim(await repository.claimCoachStart({ ...operationInput(userId, input.requestId, [input.operation, sid]), sessionId: sid, runId: crypto.randomUUID(), leaseSeconds: 120, restart: input.operation === "restart" })); if (claim.kind !== "claimed") return replay(claim, "upstream_outcome_unknown"); try { const response = requireCoachResponse(await json(await actingApiClient.start({ summary: claim.summaryPayload, subtext: { situation: claim.coachContext?.formattedSituation, character: claim.coachContext?.characterContext, subtext: claim.coachContext?.subtext } }), "coach")); await retryLocalCommit(() => repository.completeCoachTurn({ userId, sessionId: sid, runId: claim.runId, operationId: claim.operationId, leaseToken: claim.leaseToken, actingSessionId: response.session_id, aiTurnId: crypto.randomUUID(), question: response.question, action: response.action, focusTimestamp: response.focus_timestamp, done: response.done, closeReason: response.close_reason, responsePayload: response })); return ownedSession(userId, sid); } catch (error) { const mapped = asOperationError(error, "upstream_outcome_unknown"); { if (mapped.code === "acting_session_expired") await repository.expireCoachRun({ userId, sessionId: sid, runId: claim.runId, operationId: claim.operationId, leaseToken: claim.leaseToken }); else await repository.failCoachOperation({ userId, sessionId: sid, runId: claim.runId, operationId: claim.operationId, leaseToken: claim.leaseToken, failureClass: mapped.status === 429 || mapped.code === "acting_api_auth_failed" || mapped.code === "acting_api_rejected" ? "definitive" : "ambiguous", safeErrorCode: mapped.code }); } throw mapped; } }
    const runId = uuid(input.runId, "runId"); const text = input.operation === "reply" ? normalizeReply(input.text) : undefined; const actorTurnId = input.operation === "retry_reply" ? uuid(input.actorTurnId, "actorTurnId") : crypto.randomUUID(); const claim = normalizeClaim(await repository.claimCoachReply({ ...operationInput(userId, input.requestId, [input.operation, sid, runId, ...(text ? [text] : [actorTurnId])]), sessionId: sid, runId, actorTurnId, actorText: text ?? "", retryActorTurnId: input.operation === "retry_reply" ? actorTurnId : null, leaseSeconds: 120 })); if (claim.kind !== "claimed") return replay(claim, "upstream_outcome_unknown"); try { const response = requireCoachResponse(await json(await actingApiClient.reply({ session_id: claim.privateActingSessionId, text: claim.source?.actorText ?? text }), "coach"), claim.privateActingSessionId); await retryLocalCommit(() => repository.completeCoachTurn({ userId, sessionId: sid, runId, operationId: claim.operationId, leaseToken: claim.leaseToken, actingSessionId: response.session_id, aiTurnId: crypto.randomUUID(), question: response.question, action: response.action, focusTimestamp: response.focus_timestamp, done: response.done, closeReason: response.close_reason, responsePayload: response })); return ownedSession(userId, sid); } catch (error) { const mapped = asOperationError(error, "upstream_outcome_unknown"); { if (mapped.code === "acting_session_expired") await repository.expireCoachRun({ userId, sessionId: sid, runId, operationId: claim.operationId, leaseToken: claim.leaseToken, actorTurnId }); else await repository.failCoachOperation({ userId, sessionId: sid, runId, operationId: claim.operationId, leaseToken: claim.leaseToken, actorTurnId, failureClass: mapped.status === 429 || mapped.code === "acting_api_auth_failed" || mapped.code === "acting_api_rejected" ? "definitive" : "ambiguous", safeErrorCode: mapped.code }); } throw mapped; }
  },
  async getReport(sessionId: string, userId: string) { const report = await repository.getOwnedReport(userId, uuid(sessionId, "sessionId")); if (!report) throw new ActingServiceError(404, "report_not_found", "Report was not found."); return report; },
  async createReport(sessionId: string, payload: unknown, userId: string) { requireActingConfig(); const requestId = (payload as { requestId?: unknown }).requestId; const sid = uuid(sessionId, "sessionId"); const claim = normalizeClaim(await repository.claimReport({ ...operationInput(userId, String(requestId), ["report", sid]), sessionId: sid, leaseSeconds: 120 })); if (claim.kind !== "claimed") return replay(claim, "report_outcome_unknown"); try { const response = requireReportResponse(await json(await actingApiClient.report(claim.reportPayload), "report"), userId); await retryLocalCommit(() => repository.completeReport({ userId, sessionId: sid, operationId: claim.operationId, leaseToken: claim.leaseToken, reportId: crypto.randomUUID(), reportPayload: response.report, reportCount: response.report_count, responsePayload: response })); return this.getReport(sid, userId); } catch (error) { const mapped = asOperationError(error, "report_outcome_unknown"); await repository.failReport({ userId, sessionId: sid, operationId: claim.operationId, leaseToken: claim.leaseToken, failureClass: mapped.status === 429 || mapped.code === "acting_api_auth_failed" || mapped.code === "acting_api_rejected" ? "definitive" : "ambiguous", safeErrorCode: mapped.code }); throw mapped; } },
};
