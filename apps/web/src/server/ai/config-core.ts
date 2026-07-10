
import type { AiStage } from "./contracts.ts";

export interface AiServiceConfig { urls: Record<AiStage, string>; timeoutMs: number }
const names: Record<AiStage, string> = { summary: "ACTTUB_AI_SUMMARY_URL", agent: "ACTTUB_AI_AGENT_URL", report: "ACTTUB_AI_REPORT_URL" };
const loopback = (host: string) => ["localhost", "127.0.0.1", "::1"].includes(host);

export const loadAiServiceConfig = (env: NodeJS.ProcessEnv = process.env): AiServiceConfig => {
  const production = env.NODE_ENV === "production";
  const urls = {} as Record<AiStage, string>;
  for (const stage of Object.keys(names) as AiStage[]) {
    const raw = env[names[stage]];
    if (!raw) throw new Error("AI_SERVICE_CONFIGURATION_ERROR");
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw new Error("AI_SERVICE_CONFIGURATION_ERROR"); }
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("AI_SERVICE_CONFIGURATION_ERROR");
    if (production ? parsed.protocol !== "https:" || loopback(parsed.hostname) : parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback(parsed.hostname))) throw new Error("AI_SERVICE_CONFIGURATION_ERROR");
    urls[stage] = parsed.toString().replace(/\/$/, "");
  }
  const timeoutMs = Number(env.ACTTUB_AI_TIMEOUT_MS ?? 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error("AI_SERVICE_CONFIGURATION_ERROR");
  return { urls, timeoutMs };
};
