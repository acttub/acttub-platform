import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"..");
const read=(p)=>readFileSync(path.join(root,p),"utf8");
test("Summary requests use persisted scene and authoritative take lineage",()=>{const service=read("src/server/services/ai-pipeline-service.ts"),repo=read("src/server/repositories/supabase-ai-pipeline-repository.ts");assert.match(repo,/practice_takes\(\*\)/);assert.match(repo,/sceneContext:/);assert.match(repo,/mediaMetadataVersion/);assert.match(service,/const persisted=await aggregate\(sessionId,userId\)/);assert.match(service,/sceneContext:persisted\.sceneContext/);assert.match(service,/durationMs:persisted\.take\.durationMs/);});
test("idempotent creation returns persisted take and claims replay without provider duplication",()=>{const sql=read("../../supabase/migrations/004_ai_pipeline_data_plane.sql"),service=read("src/server/services/ai-pipeline-service.ts");assert.match(sql,/jsonb_build_object\('session_id',p_session_id,'take_id',t\.id\)/);assert.match(service,/summaryRun:claimed/);assert.match(service,/return \{ run: claimed, session: publicAggregate/);});
test("deletion reconciliation has a bounded server entrypoint",()=>{const service=read("src/server/services/ai-pipeline-service.ts");assert.match(service,/reconcileDeletionAttempts\(limit=25\)/);assert.match(service,/Math\.min\(100/);assert.match(service,/listDeletionReconciliationCandidates/);const route=read("src/app/api/v1/practice-sessions/deletion-reconciliation/route.ts");assert.match(route,/requireApiTermsAccepted/);assert.match(route,/reconcileDeletionAttempts\(25\)/);});
