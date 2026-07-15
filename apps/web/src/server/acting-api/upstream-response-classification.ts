export type UpstreamOperation =
  | "analysis"
  | "coach_start"
  | "coach_reply"
  | "report";

export type UpstreamFailure =
  | "auth_failed"
  | "rate_limited"
  | "video_too_large"
  | "request_rejected"
  | "route_not_found"
  | "session_expired"
  | "unavailable";

export const upstreamEndpoint = (operation: UpstreamOperation): string => ({
  analysis: "/summarize",
  coach_start: "/coach/start",
  coach_reply: "/coach/reply",
  report: "/report",
})[operation];

export function classifyUpstreamFailure(
  operation: UpstreamOperation,
  status: number,
): UpstreamFailure | null {
  if (operation === "coach_reply" && status === 404) return "session_expired";
  if (operation === "coach_start" && status === 404) return "route_not_found";
  if (status === 401) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status === 413 && operation === "analysis") return "video_too_large";
  if (status === 400 || status === 413) return "request_rejected";
  if (status < 200 || status >= 300) return "unavailable";
  return null;
}
