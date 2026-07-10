
import type { AiServiceConfig } from "./config-core.ts";
import { assertAgentResponse, assertReportResponse, assertSummaryResponse, type AgentRequest, type AiStage, type CorrelatedRequest, type ReportRequest, type SummaryRequest } from "./contracts.ts";

export type AiErrorCode = "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE" | "CORRELATION_MISMATCH";
export class AiServiceError extends Error {
  readonly stage: AiStage;
  readonly code: AiErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(stage: AiStage, code: AiErrorCode, status: number | null, retryable: boolean) {
    super(`AI ${stage} request failed`); this.name = "AiServiceError";
    this.stage = stage;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
type Fetch = typeof fetch;
const paths: Record<AiStage, string> = { summary: "/v1/summaries/generate", agent: "/v1/agent/turn", report: "/v1/reports/generate" };
const validators = { summary: assertSummaryResponse, agent: assertAgentResponse, report: assertReportResponse } as const;

const call = async <T extends CorrelatedRequest>(stage: AiStage, request: T, config: AiServiceConfig, fetcher: Fetch): Promise<Record<string, unknown>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetcher(`${config.urls[stage]}${paths[stage]}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), cache: "no-store", signal: controller.signal });
  } catch (error) {
    const timeout = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    throw new AiServiceError(stage, timeout ? "TIMEOUT" : "NETWORK_ERROR", null, true);
  } finally { clearTimeout(timer); }
  if (!response.ok) throw new AiServiceError(stage, "HTTP_ERROR", response.status, response.status === 408 || response.status === 429 || response.status >= 500);
  let body: unknown;
  try { body = await response.json(); } catch { throw new AiServiceError(stage, "INVALID_RESPONSE", response.status, false); }
  try { return validators[stage](body, request as never); }
  catch (error) { throw new AiServiceError(stage, error instanceof Error && error.message === "correlation" ? "CORRELATION_MISMATCH" : "INVALID_RESPONSE", response.status, false); }
};

export const createAiTransport = (config: AiServiceConfig, fetcher: Fetch = fetch) => ({
  summary: (request: SummaryRequest) => call("summary", request, config, fetcher),
  agent: (request: AgentRequest) => call("agent", request, config, fetcher),
  report: (request: ReportRequest) => call("report", request, config, fetcher),
});
