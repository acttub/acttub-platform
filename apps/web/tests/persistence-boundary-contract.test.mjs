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

test("Supabase admin client remains server-only", () => {
  assert.match(readApp("src/lib/supabase/admin.ts"), /import "server-only"/);
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

test("Supabase configured mode finalizes DB upload intent after storage verification and fails closed", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");

  assert.match(repository, /class SupabaseCoachSessionPersistenceError/);
  assert.match(repository, /Supabase service-role persistence is required in configured mode/);
  assert.match(repository, /Could not finalize Supabase upload intent/);
  assert.match(repository, /finalizeUploadIntent\(uploadIntent: PracticeUploadIntentDto\)[\s\S]*if \(!configuredForSupabasePersistence\(\)\) return;[\s\S]*requireSupabaseAdminClient\(\)[\s\S]*\.from\("upload_intents"\)[\s\S]*\.update\(\{[\s\S]*status: "finalized"[\s\S]*finalized_at: finalizedAt[\s\S]*\.eq\("id", uploadIntent\.uploadIntentId\)[\s\S]*\.eq\("user_id", uploadIntent\.userId\)[\s\S]*\.eq\("expected_storage_path", uploadIntent\.storagePath\)[\s\S]*\.eq\("status", "created"/s);
  assert.match(service, /await verifySupabaseStorageObject\(uploadIntent\);[\s\S]*await requireSupabasePersistence\(\(\) =>[\s\S]*supabaseCoachSessionRepository\.finalizeUploadIntent\(uploadIntent\.intent\)[\s\S]*\);[\s\S]*markUploadIntentFinalized\(uploadIntentId, userId\)/);
  assert.match(service, /error instanceof SupabaseCoachSessionPersistenceError[\s\S]*throw new ApiValidationError\("Request validation failed"/);
});

test("Supabase configured mode persists initial session read-model rows before mock session mirroring", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");

  for (const table of ["practice_sessions", "practice_takes", "observations", "question_turns"]) {
    assert.match(repository, new RegExp(`\\.from\\("${table}"\\)`));
  }

  assert.match(repository, /createSession\(input: \{[\s\S]*uploadIntent: PracticeUploadIntentDto[\s\S]*session: CoachSessionDto[\s\S]*take: TakeDto[\s\S]*observation: ObservationDto[\s\S]*firstQuestion: TurnDto[\s\S]*if \(!configuredForSupabasePersistence\(\)\) return;/s);
  assert.match(repository, /\.from\("practice_sessions"\)[\s\S]*upload_intent_id: uploadIntent\.uploadIntentId[\s\S]*status: "observations_pending"/s);
  assert.match(repository, /\.from\("practice_takes"\)[\s\S]*storage_bucket: uploadIntent\.storageBucket[\s\S]*storage_path: uploadIntent\.storagePath[\s\S]*mime_type: uploadIntent\.fileMetadata\.mimeType[\s\S]*size_bytes: uploadIntent\.fileMetadata\.sizeBytes/s);
  assert.match(repository, /\.from\("observations"\)[\s\S]*observation_text: observation\.observationText[\s\S]*source_payload: \{ source: "mock-analysis" \}/s);
  assert.match(repository, /\.from\("question_turns"\)[\s\S]*speaker: "acttub"[\s\S]*content: firstQuestion\.content[\s\S]*source_observation_ids: firstQuestion\.sourceObservationIds/s);
  assert.match(service, /const takeId = createUuid\(\);[\s\S]*const observationId = createUuid\(\);/);
  assert.match(service, /const firstQuestion = makeCoachTurn\([\s\S]*"observation_confirmation",[\s\S]*createUuid\(\),[\s\S]*\);/);
  assert.match(service, /await requireSupabasePersistence\(\(\) =>[\s\S]*supabaseCoachSessionRepository\.createSession\(\{[\s\S]*uploadIntent: finalizedUploadIntent\.intent[\s\S]*firstQuestion[\s\S]*\}\)[\s\S]*\);[\s\S]*const session = mockCoachSessionRepository\.create/s);
});
