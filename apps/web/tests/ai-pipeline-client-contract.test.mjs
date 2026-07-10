import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"..");
const read=(p)=>readFileSync(path.join(root,p),"utf8");

test("public pipeline DTOs freeze exact aggregate, run, correction, transcript, report and deletion shapes",()=>{
  const types=read("src/lib/api/types.ts");
  for(const token of [
    'pipelineVersion: "ai-pipeline.v1"','mediaMetadataVersion: "iso-bmff-duration.v1"',
    'schemaVersion: "scene-summary.v1"','schemaVersion: "report.v1"',
    "PipelineActorCorrectionDto","PipelineTranscriptTurnDto","PipelineAiRunDto",
    "ImmutablePipelineReportDto","PipelineDeletionAttemptDto",
  ]) assert.ok(types.includes(token),token);
  assert.match(types,/CreatePipelineSessionResponse = \{ session: PipelineSessionAggregateDto; summaryRun: PipelineAiRunDto \}/);
  assert.match(types,/state: "rejected"; correction\?: string/);
  assert.doesNotMatch(types,/normalizedSummary: (?:unknown|Record<string, unknown>)/);
});

test("canonical browser clients call same-origin v1 routes and never synthesize media URLs",()=>{
  const client=read("src/lib/api/practice.ts");
  const compatibility=read("src/lib/api/sessions.ts");
  for(const route of [
    "/api/v1/practice-upload-intents","/api/v1/practice-sessions",
    "/confirmation","/interview/start","/interview/turns","/interview/stop",
    "/interview/resume","/report/retry","/signed-video-url","/deletion/",
  ]) assert.ok(client.includes(route),route);
  assert.match(client,/"Idempotency-Key": requestId/);
  assert.doesNotMatch(client+compatibility,/supabase:\/\//);
  assert.doesNotMatch(client+compatibility,/https?:\/\//);
  assert.doesNotMatch(compatibility,/videoUrl:\s*`/);
  assert.match(client,/createPracticeUploadIntent\(body: CreateUploadIntentRequest\)/);
  assert.match(client,/createPipelinePracticeSession\(body: CreatePipelineSessionRequest\)/);
});

test("api modules share one safe response parser",()=>{
  const practice=read("src/lib/api/practice.ts");
  const sessions=read("src/lib/api/sessions.ts");
  const auth=read("src/lib/api/auth.ts");
  assert.match(practice,/export async function parseApiResponse/);
  assert.match(sessions,/parseApiResponse/);
  assert.match(auth,/parseApiResponse/);
  assert.doesNotMatch(sessions+auth,/function parseJsonResponse/);
  assert.match(practice,/catch \{ \/\* preserve the safe generic error \*\/ \}/);
});
