import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAiServiceConfig } from "../src/server/ai/config-core.ts";
import { AiServiceError, createAiTransport } from "../src/server/ai/transport-core.ts";

const config = { urls: { summary: "http://127.0.0.1:1", agent: "http://127.0.0.1:2", report: "http://127.0.0.1:3" }, timeoutMs: 100 };
const base = { sessionId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222" };
const observationId="33333333-3333-4333-8333-333333333333", turnId="44444444-4444-4444-8444-444444444444";
const observation={timeline:"t",dialogue:"d",tempo:"t",pitch:"p",movement:"m",expression:"e",emotion:"e",extra:[]};
const normalizedSummary={schemaVersion:"scene-summary.v1",subtextStatus:"not_provided",observation,summary:"s",intentAlignment:null,keyMoment:null,keyDimension:null,anomalies:[]};
const summaryRequest = { ...base, schemaVersion:"summary-request.v1", signedVideoUrl:"redacted", storageBucket:"practice-videos", storagePath:"x", durationMs:1, sceneContext:{genre:"g",situation:"s",characterContext:"c",subtext:null} };
const agentRequest = { ...base, schemaVersion:"agent-turn.v1", normalizedSummary, observations:[], actorCorrections:[], transcript:[], substantiveAnswerCount:0, currentInput:{command:"start",answer:null,answerTurnId:null,observationId:null} };
const reportRequest = { ...base, schemaVersion:"report-request.v1", normalizedSummary, confirmedObservations:[{observationId,sourceCandidateId:observationId,segment:{startMs:0,endMs:1},text:"x",dimension:"tempo"}], actorCorrections:[], transcript:[{turnId,speaker:"actor",content:"a",kind:"answer"}], completionReason:"manual_stop_report_ready", selectedEvidence:{observationIds:[observationId],answerTurnIds:[turnId]} };
const summaryResponse = { ...base, schemaVersion:"summary-response.v1", model:"m", promptVersion:"acting-summary.prompt.v2", normalizedSummary, observationCandidates:[] };
const agentResponse = { ...base, schemaVersion:"agent-turn.v1", model:"gemini-2.5-pro", promptVersion:"acting-agent.prompt.v2", action:"close", utterance:"마칠게요.", evidence:{observationIds:[],actorCorrectionIds:[],turnIds:[],segment:null}, done:true, completionReason:"insufficient_confirmed_evidence", reportReady:false, reportEvidence:{observationIds:[],answerTurnIds:[],coreItems:[]} };
const empty = {status:"not_confirmed",content:null,observationEvidenceIds:[],turnEvidenceIds:[],timestampRange:null};
const confirmed = {status:"confirmed",content:"근거",observationEvidenceIds:[observationId],turnEvidenceIds:[turnId],timestampRange:null};
const review = {...confirmed,turnEvidenceIds:[],timestampRange:{startMs:0,endMs:1}};
const reportResponse = { ...base, schemaVersion:"report.v1", model:"m", promptVersion:"acting-report.prompt.v2", sections:{oneLineSummary:confirmed,primaryReviewPoint:review,confirmedEvidence:confirmed,actorDiscovery:empty,groundedEncouragement:empty,nextPracticeStep:empty} };
const response = (body, status=200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {status, headers:{"content-type":"application/json"}});

test("loads explicit loopback development config and fails closed in production", () => {
  const env = { NODE_ENV:"development", ACTTUB_AI_SUMMARY_URL:"http://127.0.0.1:1", ACTTUB_AI_AGENT_URL:"http://localhost:2", ACTTUB_AI_REPORT_URL:"https://ai.example.test", ACTTUB_AI_TIMEOUT_MS:"500" };
  assert.equal(loadAiServiceConfig(env).timeoutMs, 500);
  assert.throws(() => loadAiServiceConfig({...env,NODE_ENV:"production"}), /AI_SERVICE_CONFIGURATION_ERROR/);
  assert.throws(() => loadAiServiceConfig({NODE_ENV:"production"}), /AI_SERVICE_CONFIGURATION_ERROR/);
  assert.throws(() => loadAiServiceConfig({...env,ACTTUB_AI_REPORT_URL:"https://ai.example.test/base"}), /AI_SERVICE_CONFIGURATION_ERROR/);
});

test("rejects deeply malformed Summary, Agent, and Report success bodies", async () => {
  const malformedSummary={...summaryResponse,promptVersion:"wrong",normalizedSummary:{...normalizedSummary,observation:{},anomalies:[42]},observationCandidates:Array(4).fill({bad:true})};
  const malformedAgent={...agentResponse,model:"",promptVersion:"wrong",action:"ask_question",done:true,completionReason:99,reportReady:true,evidence:{bad:true},reportEvidence:{bad:true}};
  const badSection={status:"not_confirmed",content:"must be null",observationEvidenceIds:[9],turnEvidenceIds:[{}],timestampRange:{bad:true}};
  const malformedReport={...reportResponse,promptVersion:"wrong",sections:Object.fromEntries(Object.keys(reportResponse.sections).map(key=>[key,badSection]))};
  for (const [method,request,body] of [["summary",summaryRequest,malformedSummary],["agent",agentRequest,malformedAgent],["report",reportRequest,malformedReport]]) {
    const ai=createAiTransport(config,async()=>response(body));
    await assert.rejects(ai[method](request), error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
  }
});

test("accepts all ordered Summary candidates and enforces Report evidence semantics", async () => {
  const anomalies=Array.from({length:4},()=>({start:"00:00",end:"00:01",dimension:"tempo",what:"x",whyOdd:null,likelyCause:null,impactOnIntent:null,overlapsKeyMoment:null,onKeyDimension:null,intentImpact:null,severity:null,severityReason:null}));
  const candidates=Array.from({length:4},(_,index)=>({candidateId:`00000000-0000-4000-8000-00000000000${index}`,timestampStartMs:0,timestampEndMs:1,observationText:"x",confidence:null,priority:index+1,dimension:"tempo",severity:null}));
  await createAiTransport(config,async()=>response({...summaryResponse,normalizedSummary:{...normalizedSummary,anomalies},observationCandidates:candidates})).summary(summaryRequest);
  const bad={...reportResponse,sections:{...reportResponse.sections,primaryReviewPoint:{...review,timestampRange:{startMs:0,endMs:2}}}};
  await assert.rejects(createAiTransport(config,async()=>response(bad)).report(reportRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
});

test("binds Summary candidates and subtext branch exactly to request and anomalies", async () => {
  const anomaly={start:"00:00",end:"00:01",dimension:"tempo",what:"fact",whyOdd:null,likelyCause:null,impactOnIntent:null,overlapsKeyMoment:null,onKeyDimension:null,intentImpact:null,severity:null,severityReason:null};
  const candidate={candidateId:observationId,timestampStartMs:0,timestampEndMs:1,observationText:"fact",confidence:null,priority:1,dimension:"tempo",severity:null};
  const valid={...summaryResponse,normalizedSummary:{...normalizedSummary,anomalies:[anomaly]},observationCandidates:[candidate]};
  for(const body of [{...valid,normalizedSummary:{...valid.normalizedSummary,subtextStatus:"provided"}},{...valid,observationCandidates:[]},{...valid,observationCandidates:[{...candidate,observationText:"invented"}]},{...valid,observationCandidates:[{...candidate,timestampEndMs:2}]}]){
    await assert.rejects(createAiTransport(config,async()=>response(body)).summary(summaryRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
  }
});

test("enforces Agent action reasons, unique readiness core, and referenced evidence segments", async () => {
  const request={...agentRequest,observations:[{observationId,segment:{startMs:0,endMs:1},text:"x",confirmationState:"accepted",blocked:false,confidence:null,priority:1,dimension:"tempo",severity:null}]};
  const active={...agentResponse,action:"ask_question",done:false,completionReason:null,evidence:{...agentResponse.evidence,observationIds:[observationId],segment:{startMs:0,endMs:1}}};
  await createAiTransport(config,async()=>response(active)).agent(request);
  for(const body of [{...active,evidence:{...active.evidence,segment:{startMs:0,endMs:2}}},{...active,evidence:{...active.evidence,observationIds:[],segment:{startMs:0,endMs:1}}},{...agentResponse,completionReason:null},{...active,completionReason:"manual_stop_paused"}]){
    await assert.rejects(createAiTransport(config,async()=>response(body)).agent(request),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
  }
  const ready={...agentResponse,completionReason:"manual_stop_report_ready",reportReady:true,reportEvidence:{observationIds:[observationId],answerTurnIds:[turnId],coreItems:["one_line_summary","review_point","evidence","evidence"]}};
  const readyRequest={...request,transcript:[{turnId,speaker:"actor",content:"a",kind:"answer"}]};
  await assert.rejects(createAiTransport(config,async()=>response(ready)).agent(readyRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
});

test("enforces action-specific Agent observation selection and mandatory source segments", async () => {
  const secondId="99999999-9999-4999-8999-999999999999";
  const first={observationId,segment:{startMs:0,endMs:1},text:"first",confirmationState:"unasked",blocked:false,confidence:null,priority:1,dimension:"tempo",severity:null};
  const second={...first,observationId:secondId,segment:{startMs:2,endMs:3},text:"second",priority:2};
  const request={...agentRequest,observations:[second,first]};
  const confirmation={...agentResponse,action:"confirm_observation",done:false,completionReason:null,evidence:{observationIds:[observationId],actorCorrectionIds:[],turnIds:[],segment:first.segment}};
  await createAiTransport(config,async()=>response(confirmation)).agent(request);
  for(const body of [
    {...confirmation,evidence:{...confirmation.evidence,observationIds:[secondId],segment:second.segment}},
    {...confirmation,evidence:{...confirmation.evidence,observationIds:[observationId,secondId]}},
    {...confirmation,evidence:{...confirmation.evidence,segment:null}},
    {...confirmation,evidence:{...confirmation.evidence,observationIds:[],segment:first.segment}},
  ]) await assert.rejects(createAiTransport(config,async()=>response(body)).agent(request),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
  const acceptedRequest={...request,observations:[{...first,confirmationState:"accepted"},second]};
  await assert.rejects(createAiTransport(config,async()=>response(confirmation)).agent(acceptedRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
  const question={...confirmation,action:"ask_question",evidence:{...confirmation.evidence,observationIds:[observationId]}};
  await createAiTransport(config,async()=>response(question)).agent(acceptedRequest);
  await assert.rejects(createAiTransport(config,async()=>response({...question,evidence:{...question.evidence,observationIds:[secondId],segment:second.segment}})).agent(acceptedRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
});

test("rejects every Report section-specific evidence invariant violation", async () => {
  const unknownId="66666666-6666-4666-8666-666666666666";
  const correctionId="77777777-7777-4777-8777-777777777777",correctionTurnId="88888888-8888-4888-8888-888888888888";
  const confirmedNoEvidence={status:"confirmed",content:"x",observationEvidenceIds:[],turnEvidenceIds:[],timestampRange:null};
  const cases=[
    {oneLineSummary:confirmedNoEvidence},
    {oneLineSummary:empty},
    {oneLineSummary:{...confirmed,turnEvidenceIds:[correctionTurnId]}},
    {confirmedEvidence:{...confirmed,turnEvidenceIds:[correctionTurnId]}},
    {actorDiscovery:{...confirmed,turnEvidenceIds:[]}},
    {actorDiscovery:{...confirmed,turnEvidenceIds:[unknownId]}},
    {groundedEncouragement:{...confirmed,observationEvidenceIds:[],turnEvidenceIds:[turnId]}},
    {groundedEncouragement:{...confirmed,observationEvidenceIds:[observationId],turnEvidenceIds:[unknownId]}},
    {nextPracticeStep:{...confirmed,observationEvidenceIds:[unknownId]}},
    {nextPracticeStep:{...confirmed,turnEvidenceIds:[unknownId]}},
    {nextPracticeStep:{...confirmed,timestampRange:{startMs:0,endMs:2}}},
  ];
  for (const changed of cases) {
    const body={...reportResponse,sections:{...reportResponse.sections,...changed}};
    await assert.rejects(createAiTransport(config,async()=>response(body)).report(reportRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
  }
  const correctionRequest={...reportRequest,actorCorrections:[{correctionId,correctsObservationId:observationId,segment:{startMs:2,endMs:3},text:"c",actorTurnId:correctionTurnId}],transcript:[...reportRequest.transcript,{turnId:correctionTurnId,speaker:"actor",content:"c",kind:"actor_correction"}]};
  const primaryReviewPointWithSelectedAnswer={...reportResponse.sections,primaryReviewPoint:{...review,turnEvidenceIds:[turnId],timestampRange:{startMs:0,endMs:1}}};
  await createAiTransport(config,async()=>response({...reportResponse,sections:primaryReviewPointWithSelectedAnswer})).report(reportRequest);
  const actorDiscoveryWithCorrectionTimestamp={...reportResponse.sections,actorDiscovery:{...confirmed,observationEvidenceIds:[],turnEvidenceIds:[correctionTurnId],timestampRange:{startMs:2,endMs:3}}};
  const actorDiscoveryWithoutTimestamp={...reportResponse.sections,actorDiscovery:{...confirmed,observationEvidenceIds:[],turnEvidenceIds:[correctionTurnId],timestampRange:null}};
  const optionalNonPrimarySections={...reportResponse.sections,groundedEncouragement:{status:"confirmed",content:"근거",observationEvidenceIds:[observationId],turnEvidenceIds:[],timestampRange:null},nextPracticeStep:{status:"confirmed",content:"다음",observationEvidenceIds:[observationId],turnEvidenceIds:[],timestampRange:null}};
  await createAiTransport(config,async()=>response({...reportResponse,sections:actorDiscoveryWithCorrectionTimestamp})).report(correctionRequest);
  await createAiTransport(config,async()=>response({...reportResponse,sections:actorDiscoveryWithoutTimestamp})).report(correctionRequest);
  await createAiTransport(config,async()=>response({...reportResponse,sections:optionalNonPrimarySections})).report(reportRequest);
  const correctionOnlyTimestamp={...reportResponse,sections:{...reportResponse.sections,primaryReviewPoint:{...review,turnEvidenceIds:[correctionTurnId],timestampRange:{startMs:2,endMs:3}}}};
  await assert.rejects(createAiTransport(config,async()=>response(correctionOnlyTimestamp)).report(correctionRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
});

test("accepts optional report timestamps on non-primary sections and requires primaryReviewPoint", async () => {
  const optionalReport={...reportResponse,sections:{...reportResponse.sections,oneLineSummary:{status:"confirmed",content:"근거",observationEvidenceIds:[observationId],turnEvidenceIds:[turnId],timestampRange:null},confirmedEvidence:{status:"confirmed",content:"근거",observationEvidenceIds:[observationId],turnEvidenceIds:[turnId],timestampRange:null},actorDiscovery:{status:"confirmed",content:"근거",observationEvidenceIds:[],turnEvidenceIds:[turnId],timestampRange:null},groundedEncouragement:{status:"confirmed",content:"근거",observationEvidenceIds:[observationId],turnEvidenceIds:[],timestampRange:null},nextPracticeStep:{status:"confirmed",content:"근거",observationEvidenceIds:[observationId],turnEvidenceIds:[],timestampRange:null}}};
  await createAiTransport(config,async()=>response(optionalReport)).report(reportRequest);
  const missingPrimaryTimestamp={...reportResponse,sections:{...reportResponse.sections,primaryReviewPoint:{...review,timestampRange:null}}};
  await assert.rejects(createAiTransport(config,async()=>response(missingPrimaryTimestamp)).report(reportRequest),error=>error instanceof AiServiceError&&error.code==="INVALID_RESPONSE");
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
  for (const [body,code] of [["{","INVALID_RESPONSE"],[{...summaryResponse,extra:true},"INVALID_RESPONSE"],[{...summaryResponse,runId:"55555555-5555-4555-8555-555555555555"},"CORRELATION_MISMATCH"]]) {
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
