import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAiServiceConfig } from "../src/server/ai/config-core.ts";
import { AiServiceError, createAiTransport } from "../src/server/ai/transport-core.ts";

const config = { urls: { summary: "http://127.0.0.1:1", agent: "http://127.0.0.1:2", report: "http://127.0.0.1:3" }, timeoutMs: 100 };
const base = { sessionId: "session-1", runId: "run-1" };
const summaryRequest = { ...base, schemaVersion:"summary-request.v1", signedVideoUrl:"redacted", storageBucket:"practice-videos", storagePath:"x", durationMs:1, sceneContext:{} };
const agentRequest = { ...base, schemaVersion:"agent-turn.v1", normalizedSummary:{}, observations:[], actorCorrections:[], transcript:[], substantiveAnswerCount:0, currentInput:{} };
const reportRequest = { ...base, schemaVersion:"report-request.v1", normalizedSummary:{}, confirmedObservations:[], actorCorrections:[], transcript:[], completionReason:"manual_stop_report_ready", selectedEvidence:{} };
const summaryResponse = { ...base, schemaVersion:"summary-response.v1", model:"m", promptVersion:"acting-summary.prompt.v2", normalizedSummary:{schemaVersion:"scene-summary.v1",subtextStatus:"not_provided",observation:{},summary:"s",anomalies:[]}, observationCandidates:[] };
const agentResponse = { ...base, schemaVersion:"agent-turn.v1", action:"close", utterance:"마칠게요.", evidence:{}, done:true, completionReason:"insufficient_confirmed_evidence", reportReady:false, reportEvidence:{} };
const empty = {status:"not_confirmed",content:null,observationEvidenceIds:[],turnEvidenceIds:[],timestampRange:null};
const reportResponse = { ...base, schemaVersion:"report.v1", model:"m", promptVersion:"acting-report.prompt.v2", sections:{oneLineSummary:empty,primaryReviewPoint:empty,confirmedEvidence:empty,actorDiscovery:empty,groundedEncouragement:empty,nextPracticeStep:empty} };
const response = (body, status=200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {status, headers:{"content-type":"application/json"}});

test("loads explicit loopback development config and fails closed in production", () => {
  const env = { NODE_ENV:"development", ACTTUB_AI_SUMMARY_URL:"http://127.0.0.1:1", ACTTUB_AI_AGENT_URL:"http://localhost:2", ACTTUB_AI_REPORT_URL:"https://ai.example.test", ACTTUB_AI_TIMEOUT_MS:"500" };
  assert.equal(loadAiServiceConfig(env).timeoutMs, 500);
  assert.throws(() => loadAiServiceConfig({...env,NODE_ENV:"production"}), /AI_SERVICE_CONFIGURATION_ERROR/);
  assert.throws(() => loadAiServiceConfig({NODE_ENV:"production"}), /AI_SERVICE_CONFIGURATION_ERROR/);
});

test("calls each exact endpoint once and validates versions and correlation", async () => {
  const calls=[]; const bodies=[summaryResponse,agentResponse,reportResponse];
  const fetcher=async (url, init) => { calls.push({url,init}); return response(bodies.shift()); };
  const ai=createAiTransport(config,fetcher);
  await ai.summary(summaryRequest); await ai.agent(agentRequest); await ai.report(reportRequest);
  assert.deepEqual(calls.map(x=>x.url),["http://127.0.0.1:1/v1/summaries/generate","http://127.0.0.1:2/v1/agent/turn","http://127.0.0.1:3/v1/reports/generate"]);
  assert.ok(calls.every(x=>x.init.cache === "no-store"));
});

test("rejects malformed JSON, schema drift, and correlation mismatch", async () => {
  for (const [body,code] of [["{","INVALID_RESPONSE"],[{...summaryResponse,extra:true},"INVALID_RESPONSE"],[{...summaryResponse,runId:"other"},"CORRELATION_MISMATCH"]]) {
    const ai=createAiTransport(config,async()=>response(body));
    await assert.rejects(ai.summary(summaryRequest), error => error instanceof AiServiceError && error.code===code);
  }
});

test("sanitizes HTTP and network failures without URL/body/provider text", async () => {
  const secret="sensitive-provider-body";
  for (const fetcher of [async()=>response(secret,503),async()=>{throw new Error(secret)}]) {
    const ai=createAiTransport(config,fetcher);
    await assert.rejects(ai.report(reportRequest), error => {
      assert.ok(error instanceof AiServiceError); assert.equal(error.stage,"report");
      assert.ok(!JSON.stringify(error).includes(secret)); assert.ok(!error.message.includes("127.0.0.1")); return true;
    });
  }
});

test("aborts at the bounded timeout and does not retry", async () => {
  let calls=0;
  const fetcher=(_url,init)=>new Promise((_resolve,reject)=>{ calls++; init.signal.addEventListener("abort",()=>reject(new DOMException("x","AbortError"))); });
  const ai=createAiTransport(config,fetcher);
  await assert.rejects(ai.agent(agentRequest), error => error instanceof AiServiceError && error.code==="TIMEOUT" && error.retryable);
  assert.equal(calls,1);
});
