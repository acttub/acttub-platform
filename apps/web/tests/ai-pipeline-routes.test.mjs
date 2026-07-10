import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
const root=path.resolve(import.meta.dirname,".."); const read=p=>readFileSync(path.join(root,p),"utf8");
const routes=[
["src/app/api/v1/practice-sessions/[sessionId]/observations/[observationId]/confirmation/route.ts","confirmObservation"],
["src/app/api/v1/practice-sessions/[sessionId]/interview/start/route.ts","startInterview"],
["src/app/api/v1/practice-sessions/[sessionId]/interview/turns/route.ts","addTurn"],
["src/app/api/v1/practice-sessions/[sessionId]/interview/stop/route.ts","stopInterview"],
["src/app/api/v1/practice-sessions/[sessionId]/interview/resume/route.ts","resumeInterview"],
["src/app/api/v1/practice-sessions/[sessionId]/report/route.ts","getReport"],
["src/app/api/v1/practice-sessions/[sessionId]/report/retry/route.ts","retryReport"]];
test("pipeline routes are authenticated owner-scoped thin handlers",()=>{for(const [file,method] of routes){const source=read(file);assert.match(source,/requireApiTermsAccepted/);assert.match(source,new RegExp(`aiPipelineService\\.${method}\\(sessionId,`));assert.match(source,/auth\.userId/);assert.match(source,/handleApiError/);}});
test("pipeline service filters public candidates and preserves safe boundaries",()=>{const source=read("src/server/services/ai-pipeline-service.ts");assert.match(source,/priority <= 3/);assert.match(source,/requireCurrentAiProcessingConsent/);assert.match(source,/repository\.claimRun/);assert.match(source,/repository\.appendPipelineTurn/);assert.match(source,/REPORT_NOT_RETRYABLE/);assert.doesNotMatch(source,/console\.|signedVideoUrl/);});
