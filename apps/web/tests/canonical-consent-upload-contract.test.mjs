import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"..");
const read=(p)=>readFileSync(path.join(root,p),"utf8");

test("canonical consent is current, dual-purpose, and internal review never gates",()=>{
  const auth=read("src/server/services/auth-context.ts");
  assert.match(auth,/current_acttub_terms_version/);
  assert.match(auth,/current_acttub_ai_processing_consent_version/);
  assert.match(auth,/required_consent_version === versions\.requiredConsentVersion/);
  assert.match(auth,/ai_processing_consent_version === versions\.aiProcessingConsentVersion/);
  assert.doesNotMatch(auth,/Boolean\(data\.internal_review_consent_at\)/);
  assert.match(auth,/internal_review_consent: internalReviewConsent/);
  assert.match(auth,/internalReviewConsent:\s*\{\s*accepted: Boolean\(context\?\.internalReviewConsent\)/);
});

test("upload intent requires confirmations and persists only server authority",()=>{
  const service=read("src/server/services/coach-session-service.ts");
  const repo=read("src/server/repositories/supabase-coach-session-repository.ts");
  assert.match(service,/input\.adultConfirmed !== true \|\| input\.allParticipantsConfirmed !== true/);
  assert.match(service,/Consent versions, timestamps, and duration are server-authoritative/);
  assert.match(service,/getCurrentConsentVersions/);
  for(const field of ["required_consent_version_snapshot","ai_processing_consent_version_snapshot","adult_confirmed_at","all_participants_confirmed_at"])
    assert.match(repo,new RegExp(field));
});

test("finalize and pipeline reject browser authority and stale eligibility",()=>{
  const service=read("src/server/services/coach-session-service.ts");
  const pipeline=read("src/server/ai-pipeline-service-core.js");
  const repo=read("src/server/repositories/supabase-ai-pipeline-repository.ts");
  assert.match(service,/Object\.keys\(input\)\.some\(\(key\) => key !== "storagePath"\)/);
  assert.match(service,/uploadIntentId,[\s\S]*mediaMetadataVersion: "iso-bmff-duration\.v1"/);
  assert.doesNotMatch(service,/return \{[\s\S]{0,120}videoUrl: videoRefForUploadIntent/);
  assert.match(repo,/adult_confirmed_at,all_participants_confirmed_at,ai_eligible_at/);
  assert.match(pipeline,/upload\.requiredConsentVersionSnapshot!==consent\.requiredConsentVersion/);
  assert.match(pipeline,/upload\.aiProcessingConsentVersionSnapshot!==consent\.aiProcessingConsentVersion/);
  assert.ok((pipeline.match(/deps\.requireCurrentAiProcessingConsent\(userId\)/g)??[]).length>=3);
});

test("OpenAPI exposes confirmations and forbids browser duration and consent evidence",()=>{
  const doc=JSON.parse(read("src/lib/api/openapi.json"));
  const create=doc.components.schemas.CreateUploadIntentRequest;
  assert.deepEqual(create.required,["fileMetadata","adultConfirmed","allParticipantsConfirmed"]);
  assert.equal(create.properties.adultConfirmed.const,true);
  assert.equal(create.properties.allParticipantsConfirmed.const,true);
  assert.equal(create.additionalProperties,false);
  assert.equal("durationMs" in create.properties.fileMetadata,false);
  assert.equal("durationMs" in doc.components.schemas.FileMetadata.properties,false);
  assert.deepEqual(doc.components.schemas.CreateSessionRequest.required,["sessionId","uploadIntentId","storagePath","genre","situation","characterContext"]);
  assert.equal("medium" in doc.components.schemas.CreateSessionRequest.properties,false);
  const finalized=doc.components.schemas.FinalizeUploadIntentResponse;
  assert.deepEqual(finalized.required,["uploadIntentId","storagePath","durationMs","mediaMetadataVersion"]);
  assert.equal("videoUrl" in finalized.properties,false);
  assert.deepEqual(finalized.properties.durationMs,{type:"integer",minimum:1,maximum:300000});
  assert.equal(finalized.properties.mediaMetadataVersion.const,"iso-bmff-duration.v1");
});
