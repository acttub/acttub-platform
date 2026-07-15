import "server-only";

export const SUMMARY_TIMEOUT_MS = 270_000;
export const COACH_TIMEOUT_MS = 90_000;
export const REPORT_TIMEOUT_MS = 90_000;

export function getActingApiConfig() {
  const baseUrl = process.env.ACTING_API_BASE_URL?.trim().replace(/\/$/u, "");
  const apiKey = process.env.ACTING_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error("acting_api_not_configured");
  return { baseUrl, apiKey };
}
