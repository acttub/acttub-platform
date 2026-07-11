
import type { AiServiceConfig } from "./config-core.ts";
import { assertAgentResponse, assertReportResponse, assertSummaryResponse, type AgentRequest, type AiStage, type ReportRequest, type SummaryRequest } from "./contracts.ts";

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
type StageRequest = { stage:"summary"; request:SummaryRequest } | { stage:"agent"; request:AgentRequest } | { stage:"report"; request:ReportRequest };

const call = async (stageRequest: StageRequest, config: AiServiceConfig, fetcher: Fetch): Promise<Record<string, unknown>> => {
  const { stage, request } = stageRequest;
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
  try {
    if(stageRequest.stage==="summary") return assertSummaryResponse(body,stageRequest.request);
    if(stageRequest.stage==="agent") return assertAgentResponse(body,stageRequest.request);
    return assertReportResponse(body,stageRequest.request);
  }
  catch (error) { throw new AiServiceError(stage, error instanceof Error && error.message === "correlation" ? "CORRELATION_MISMATCH" : "INVALID_RESPONSE", response.status, false); }
};

export const createAiTransport = (config: AiServiceConfig, fetcher: Fetch = fetch) => ({
  summary: (request: SummaryRequest) => call({stage:"summary",request}, config, fetcher),
  agent: (request: AgentRequest) => call({stage:"agent",request}, config, fetcher),
  report: (request: ReportRequest) => call({stage:"report",request}, config, fetcher),
});
