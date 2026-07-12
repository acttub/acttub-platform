import "server-only";

export class ActingApiResponseError extends Error {
  readonly causeCode = "acting_api_invalid_response" as const;

  constructor() {
    super("acting-api returned an invalid response");
    this.name = "ActingApiResponseError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown): value is string =>
  typeof value === "string";

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ActingApiResponseError();
  return value;
}

export function requireSceneSummary(value: unknown): Record<string, unknown> {
  const response = requireRecord(value);
  if (
    !isRecord(response.observation) ||
    !requireString(response.summary) ||
    !requireString(response.intent_alignment) ||
    !requireString(response.key_moment) ||
    !requireString(response.key_dimension) ||
    !Array.isArray(response.anomalies) ||
    !response.anomalies.every(isRecord)
  ) {
    throw new ActingApiResponseError();
  }
  return response;
}

const coachActions = new Set(["probe_intent", "dig_cause", "deflect", "close"]);

export function requireCoachResponse(value: unknown, expectedSessionId?: string) {
  const response = requireRecord(value);
  if (
    !requireString(response.session_id) ||
    !requireString(response.utterance) ||
    !requireString(response.action) ||
    !coachActions.has(response.action) ||
    !requireString(response.focus_timestamp) ||
    typeof response.done !== "boolean" ||
    !(response.reason === null || requireString(response.reason))
  ) {
    throw new ActingApiResponseError();
  }
  if (expectedSessionId && response.session_id !== expectedSessionId) {
    throw new ActingApiResponseError();
  }
  return response as Record<string, unknown> & {
    session_id: string;
    utterance: string;
    action: "probe_intent" | "dig_cause" | "deflect" | "close";
    focus_timestamp: string;
    done: boolean;
    reason: string | null;
  };
}

export function requireReportResponse(value: unknown, expectedUserId: string) {
  const response = requireRecord(value);
  const report = isRecord(response.report) ? response.report : null;
  const biggestProblem = report && isRecord(report.biggest_problem)
    ? report.biggest_problem
    : null;

  if (
    response.user_id !== expectedUserId ||
    !Number.isInteger(response.report_count) ||
    (response.report_count as number) < 1 ||
    !report ||
    !requireString(report.headline) ||
    !biggestProblem ||
    !requireString(biggestProblem.start) ||
    !requireString(biggestProblem.end) ||
    !requireString(biggestProblem.dimension) ||
    !requireString(biggestProblem.description) ||
    !requireString(report.evidence) ||
    !requireString(report.self_discovery) ||
    !requireString(report.encouragement) ||
    !requireString(report.next_step) ||
    !requireString(report.comparison)
  ) {
    throw new ActingApiResponseError();
  }

  return response as Record<string, unknown> & {
    user_id: string;
    report_count: number;
    report: Record<string, unknown>;
  };
}
