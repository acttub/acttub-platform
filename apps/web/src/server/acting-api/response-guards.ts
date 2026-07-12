import "server-only";

export class ActingApiResponseError extends Error {
  constructor(readonly causeCode: "acting_api_invalid_response" = "acting_api_invalid_response") {
    super("acting-api returned an invalid response");
    this.name = "ActingApiResponseError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ActingApiResponseError();
  return value;
}

export function requireCoachResponse(value: unknown, expectedSessionId?: string) {
  const response = requireRecord(value);
  if (typeof response.session_id !== "string" || typeof response.question !== "string" || typeof response.done !== "boolean") {
    throw new ActingApiResponseError();
  }
  if (expectedSessionId && response.session_id !== expectedSessionId) throw new ActingApiResponseError();
  return response;
}

export function requireReportResponse(value: unknown, expectedUserId: string) {
  const response = requireRecord(value);
  if (response.user_id !== expectedUserId || !Number.isInteger(response.report_count) || (response.report_count as number) < 1) {
    throw new ActingApiResponseError();
  }
  return response;
}
