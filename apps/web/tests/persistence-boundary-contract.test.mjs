import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const readApp = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if ([".next", "node_modules"].includes(entry)) return [];
    const stats = statSync(absolute);
    if (stats.isDirectory()) return walk(absolute);
    return /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

test("session persistence is isolated behind server repository boundary", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  assert.match(service, /mockCoachSessionRepository/);
  assert.doesNotMatch(service, /globalThis\.__acttubMockCoachSessionRepository/);
  const repository = readApp("src/server/repositories/mock-coach-session-repository.ts");
  assert.match(repository, /__acttubMockCoachSessionRepository/);
  assert.match(repository, /ownerUserId/);
});

test("client modules do not import server persistence or Supabase admin", () => {
  const clientFiles = walk(path.join(appRoot, "src")).filter((file) => !file.includes(`${path.sep}server${path.sep}`) && !file.includes(`${path.sep}app${path.sep}api${path.sep}`) && !file.includes(`${path.sep}app${path.sep}auth${path.sep}`));
  const offenders = clientFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes("@/server/") || source.includes("@/lib/supabase/admin");
  }).map((file) => path.relative(repoRoot, file));
  assert.deepEqual(offenders, []);
});

test("Supabase service-role access is isolated to the server-only admin module", () => {
  const config = readApp("src/lib/config/env.ts");
  const admin = readApp("src/lib/supabase/admin.ts");

  assert.doesNotMatch(config, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(config, /getSupabaseServiceRoleKey/);
  assert.match(admin, /import "server-only"/);
  assert.match(admin, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /function getSupabaseServiceRoleKey\(\): string \| null/);
  assert.doesNotMatch(admin, /import \{ getAppConfig, getSupabaseServiceRoleKey \} from "@\/lib\/config\/env"/);
});

test("Supabase configured mode persists upload intents before mock mirroring", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");
  const types = readApp("src/lib/api/types.ts");

  assert.match(repository, /import "server-only"/);
  assert.match(repository, /createSupabaseAdminClient/);
  assert.match(repository, /configuredForSupabasePersistence/);
  assert.match(repository, /config\.supabase\.isConfigured && config\.video\.bucket === "practice-videos"/);
  assert.match(repository, /createUploadIntent\(uploadIntent: PracticeUploadIntentDto\)[\s\S]*if \(!configuredForSupabasePersistence\(\)\) return;[\s\S]*requireSupabaseAdminClient\(\)[\s\S]*\.from\("upload_intents"\)[\s\S]*\.insert\(\{[\s\S]*id: uploadIntent\.uploadIntentId[\s\S]*user_id: uploadIntent\.userId[\s\S]*session_id: uploadIntent\.sessionId[\s\S]*status: "created"[\s\S]*expected_storage_bucket: uploadIntent\.storageBucket[\s\S]*expected_storage_path: uploadIntent\.storagePath[\s\S]*expected_mime_type: uploadIntent\.fileMetadata\.mimeType[\s\S]*expected_size_bytes: uploadIntent\.fileMetadata\.sizeBytes[\s\S]*consent_version: getAppConfig\(\)\.termsVersion[\s\S]*expires_at: uploadIntent\.expiresAt/s);
  assert.match(service, /await requireSupabasePersistence\(\(\) =>[\s\S]*supabaseCoachSessionRepository\.createUploadIntent\(uploadIntent\)[\s\S]*\);[\s\S]*return mockCoachSessionRepository\.saveUploadIntent\(uploadIntent, userId\)/);
  assert.match(types, /export type PracticeUploadIntentDto = \{[\s\S]*fileMetadata: FileMetadataDto;/);
});

test("Supabase configured mode verifies DB upload intent but leaves finalization to atomic session RPC", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");
  const migration = readFileSync(path.join(repoRoot, "supabase/migrations/001_acttub_slice1_schema.sql"), "utf8");

  assert.match(repository, /class SupabaseCoachSessionPersistenceError/);
  assert.match(repository, /Supabase service-role persistence is required in configured mode/);
  assert.match(repository, /Could not finalize Supabase upload intent/);
  assert.match(repository, /finalizeUploadIntent\(uploadIntent: PracticeUploadIntentDto\)[\s\S]*\.from\("upload_intents"\)[\s\S]*\.select\("id"\)[\s\S]*\.eq\("id", uploadIntent\.uploadIntentId\)[\s\S]*\.eq\("user_id", uploadIntent\.userId\)[\s\S]*\.eq\("expected_storage_path", uploadIntent\.storagePath\)[\s\S]*\.eq\("status", "created"\)/s);
  assert.doesNotMatch(repository, /finalizeUploadIntent[\s\S]*\.update\(\{[\s\S]*status: "finalized"/s);
  assert.match(service, /await verifySupabaseStorageObject\(uploadIntent\);[\s\S]*supabaseCoachSessionRepository\.finalizeUploadIntent\(uploadIntent\.intent\)[\s\S]*markUploadIntentFinalized\(uploadIntentId, userId\)/);
  assert.match(migration, /create or replace function public\.acttub_create_session_from_upload_intent[\s\S]*for update[\s\S]*update public\.upload_intents[\s\S]*status = 'finalized'[\s\S]*insert into public\.practice_sessions/s);
  assert.match(service, /error instanceof SupabaseCoachSessionPersistenceError[\s\S]*throw new ApiValidationError\("Request validation failed"/);
});

test("Supabase configured mode atomically creates initial session rows before mock session mirroring", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");
  const migration = readFileSync(path.join(repoRoot, "supabase/migrations/001_acttub_slice1_schema.sql"), "utf8");

  assert.match(repository, /createSession\(input: \{[\s\S]*uploadIntent: PracticeUploadIntentDto[\s\S]*session: CoachSessionDto[\s\S]*take: TakeDto[\s\S]*observation: ObservationDto[\s\S]*firstQuestion: TurnDto[\s\S]*if \(!configuredForSupabasePersistence\(\)\) return input\.session;/s);
  assert.match(repository, /\.rpc\("acttub_create_session_from_upload_intent", \{[\s\S]*p_upload_intent_id: uploadIntent\.uploadIntentId[\s\S]*p_take_id: take\.id[\s\S]*p_observation_id: observation\.id[\s\S]*p_first_question_id: firstQuestion\.id/s);
  assert.doesNotMatch(repository, /createSession\(input:[\s\S]*\.from\("practice_sessions"\)[\s\S]*\.from\("practice_takes"\)[\s\S]*\.from\("observations"\)[\s\S]*\.from\("question_turns"/s);
  const atomicFunction = migration.slice(migration.indexOf("acttub_create_session_from_upload_intent"));
  for (const table of ["practice_sessions", "practice_takes", "observations", "question_turns"]) {
    assert.ok(atomicFunction.includes(`insert into public.${table}`));
  }
  assert.match(service, /const takeId = createUuid\(\);[\s\S]*const observationId = createUuid\(\);/);
  assert.match(service, /const firstQuestion = makeCoachTurn\([\s\S]*"observation_confirmation",[\s\S]*createUuid\(\),[\s\S]*\);/);
  assert.match(service, /supabaseCoachSessionRepository\.isConfigured\(\)[\s\S]*supabaseCoachSessionRepository\.createSession\(\{[\s\S]*uploadIntent: finalizedUploadIntent\.intent[\s\S]*firstQuestion[\s\S]*\}\)[\s\S]*const session = mockCoachSessionRepository\.create/s);
});

 test("Supabase configured lifecycle reads and mutations source Supabase before mock mirroring", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");

  for (const method of ["listVisible", "findById", "updateObservationState", "addTurnPair", "saveValidationMetrics", "createSummary", "updateVisibility"]) {
    assert.ok(repository.includes(`${method}(`));
  }
  assert.match(repository, /const mapSession = \(row: JsonRecord\): CoachSessionDto =>/);
  assert.match(repository, /const mapDbStatus = \(status: unknown\): SessionStatus =>/);
  assert.match(repository, /speaker = asString\(row\.speaker\) === "actor" \? "actor" : "coach"/);
  assert.match(service, /async listSessions\(userId: string\)[\s\S]*supabaseCoachSessionRepository\.listVisible\(userId\)/);
  assert.match(service, /const readSessionForOwner = async[\s\S]*supabaseCoachSessionRepository\.findById\(sessionId, userId\)/);
  assert.match(service, /updateObservationState\([\s\S]*mirrorSupabaseSessionToMock\(session, userId\)/);
  assert.match(service, /addTurnPair\([\s\S]*mirrorSupabaseSessionToMock\(withCoachTurn, userId\)/);
  assert.match(service, /saveValidationMetrics\([\s\S]*supabaseCoachSessionRepository\.saveValidationMetrics\([\s\S]*mirrorSupabaseSessionToMock\(updatedSession, userId\)/);
  assert.match(service, /createSummary\([\s\S]*supabaseCoachSessionRepository\.createSummary\([\s\S]*mirrorSupabaseSessionToMock\(updatedSession, userId\)/);
});
