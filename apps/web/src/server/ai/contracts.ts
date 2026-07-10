export type AiStage = "summary" | "agent" | "report";
export type JsonObject = Record<string, unknown>;

export interface CorrelatedRequest extends JsonObject {
  schemaVersion: string;
  sessionId: string;
  runId: string;
}

export interface SummaryRequest extends CorrelatedRequest {
  schemaVersion: "summary-request.v1";
  signedVideoUrl: string;
  storageBucket: "practice-videos";
  storagePath: string;
  durationMs: number;
  sceneContext: JsonObject;
}
export interface AgentRequest extends CorrelatedRequest { schemaVersion: "agent-turn.v1"; normalizedSummary: JsonObject; observations: unknown[]; actorCorrections: unknown[]; transcript: unknown[]; substantiveAnswerCount: number; currentInput: JsonObject }
export interface ReportRequest extends CorrelatedRequest { schemaVersion: "report-request.v1"; normalizedSummary: JsonObject; confirmedObservations: unknown[]; actorCorrections: unknown[]; transcript: unknown[]; completionReason: string; selectedEvidence: JsonObject }

const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  return value as JsonObject;
};
const string = (value: unknown) => { if (typeof value !== "string" || !value) throw new Error("invalid"); return value; };
const bool = (value: unknown) => { if (typeof value !== "boolean") throw new Error("invalid"); return value; };
const array = (value: unknown) => { if (!Array.isArray(value)) throw new Error("invalid"); return value; };
const exactKeys = (value: JsonObject, keys: string[]) => {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid");
};
const correlated = (value: JsonObject, version: string, request: CorrelatedRequest) => {
  if (value.schemaVersion !== version) throw new Error("invalid");
  if (value.sessionId !== request.sessionId || value.runId !== request.runId) throw new Error("correlation");
  string(value.model); string(value.promptVersion);
};

export const assertSummaryResponse = (input: unknown, request: SummaryRequest) => {
  const value = object(input);
  exactKeys(value, ["schemaVersion", "sessionId", "runId", "model", "promptVersion", "normalizedSummary", "observationCandidates"]);
  correlated(value, "summary-response.v1", request);
  const summary = object(value.normalizedSummary);
  if (summary.schemaVersion !== "scene-summary.v1" || !["provided", "not_provided"].includes(String(summary.subtextStatus))) throw new Error("invalid");
  object(summary.observation); string(summary.summary); array(summary.anomalies); array(value.observationCandidates);
  return value;
};

export const assertAgentResponse = (input: unknown, request: AgentRequest) => {
  const value = object(input);
  exactKeys(value, ["schemaVersion", "sessionId", "runId", "action", "utterance", "evidence", "done", "completionReason", "reportReady", "reportEvidence"]);
  correlated({ ...value, model: "agent", promptVersion: "agent-turn.v1" }, "agent-turn.v1", request);
  if (!["confirm_observation", "ask_question", "close", "pause"].includes(String(value.action))) throw new Error("invalid");
  string(value.utterance); object(value.evidence); bool(value.done); bool(value.reportReady); object(value.reportEvidence);
  return value;
};

const section = (input: unknown) => {
  const value = object(input);
  exactKeys(value, ["status", "content", "observationEvidenceIds", "turnEvidenceIds", "timestampRange"]);
  if (!["confirmed", "not_confirmed"].includes(String(value.status))) throw new Error("invalid");
  if (value.content !== null && typeof value.content !== "string") throw new Error("invalid");
  array(value.observationEvidenceIds); array(value.turnEvidenceIds);
  if (value.timestampRange !== null) object(value.timestampRange);
};
export const assertReportResponse = (input: unknown, request: ReportRequest) => {
  const value = object(input);
  exactKeys(value, ["schemaVersion", "sessionId", "runId", "model", "promptVersion", "sections"]);
  correlated(value, "report.v1", request);
  const sections = object(value.sections);
  const keys = ["oneLineSummary", "primaryReviewPoint", "confirmedEvidence", "actorDiscovery", "groundedEncouragement", "nextPracticeStep"];
  exactKeys(sections, keys); if (Object.keys(sections).length !== keys.length) throw new Error("invalid");
  keys.forEach((key) => section(sections[key]));
  return value;
};
