import "server-only";
import { getActingApiConfig, SUMMARY_TIMEOUT_MS, COACH_TIMEOUT_MS, REPORT_TIMEOUT_MS } from "./config";
import { createMultipartStream } from "./multipart";

async function request(path: string, init: RequestInit, timeoutMs: number) {
  const { baseUrl, apiKey } = getActingApiConfig();
  return fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "X-API-Key": apiKey, ...init.headers } });
}

export const actingApiClient = {
  summarize(input: { situation: string; character: string; subtext: string; video: ReadableStream<Uint8Array>; fileName: string; mimeType: string }) {
    const multipart = createMultipartStream({ fields: { situation: input.situation, character: input.character, subtext: input.subtext }, video: input.video, fileName: input.fileName, mimeType: input.mimeType });
    return request("/summarize", { method: "POST", body: multipart.body, duplex: "half", headers: { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` } } as RequestInit, SUMMARY_TIMEOUT_MS);
  },
  start(payload: unknown) { return request("/coach/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, COACH_TIMEOUT_MS); },
  reply(payload: unknown) { return request("/coach/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, COACH_TIMEOUT_MS); },
  report(payload: unknown) { return request("/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, REPORT_TIMEOUT_MS); },
};
