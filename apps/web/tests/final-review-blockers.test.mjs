import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const webRoot = path.join(repoRoot, "apps/web");

const readRepo = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const readWeb = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");

const apiRoutesRequiringActiveUser = [
  "src/app/api/v1/practice-upload-intents/route.ts",
  "src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts",
  "src/app/api/v1/practice-sessions/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/hide/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/metrics/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/observations/[observationId]/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/result/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/signed-video-url/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/turns/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/video-url/route.ts",
  "src/app/api/v1/practice-sessions/[sessionId]/visibility/route.ts",
  "src/app/api/v1/sessions/route.ts",
  "src/app/api/v1/sessions/[sessionId]/route.ts",
  "src/app/api/v1/sessions/[sessionId]/observations/[observationId]/route.ts",
  "src/app/api/v1/sessions/[sessionId]/summary/route.ts",
  "src/app/api/v1/sessions/[sessionId]/turns/route.ts",
];

test("auth-bound Slice 1 API routes require current terms before touching session state", () => {
  const missingGate = [];

  for (const routePath of apiRoutesRequiringActiveUser) {
    const source = readWeb(routePath);
    if (!source.includes("requireApiTermsAccepted")) {
      missingGate.push(routePath);
    }
  }

  assert.deepEqual(missingGate, []);
});

test("auth-bound routes pass owner id into session service calls", () => {
  const missingOwner = [];
  const unownedCallPattern = /coachSessionService\.(?:listSessions|createSession|getSession|softHideSession|createSignedVideoUrl|getSignedVideoUrl|updateObservation|createTurn|saveValidationMetrics|createSummary|finalizeUploadIntent)\([^;\n]*\)/g;

  for (const routePath of apiRoutesRequiringActiveUser) {
    const source = readWeb(routePath);
    const calls = source.match(unownedCallPattern) ?? [];
    for (const call of calls) {
      if (!call.includes("auth.userId")) {
        missingOwner.push(`${routePath}: ${call}`);
      }
    }
  }

  assert.deepEqual(missingOwner, []);
});

test("upload intent finalization binds the path parameter to owner, expiry, and storage path validation", () => {
  const route = readWeb("src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  assert.match(route, /const \{ uploadIntentId \} = await context\.params/);
  assert.match(route, /finalizeUploadIntent\(uploadIntentId, payload, auth\.userId\)/);

  const service = readWeb("src/server/services/coach-session-service.ts");
  assert.match(service, /findUploadIntent\(uploadIntentId, ownerId\)/);
  assert.match(service, /Upload intent has expired/);
  assert.match(service, /storagePath !== uploadIntent\.intent\.storagePath/);
  assert.match(service, /Upload intent must be finalized before creating a session/);
  assert.match(service, /validatedMedium === "upload_url" && !input\.uploadIntentId/);
});

test("mock persistence preserves session and upload intent owner boundaries", () => {
  const repository = readWeb("src/server/repositories/mock-coach-session-repository.ts");
  assert.match(repository, /sessionOwners: Map<string, string>/);
  assert.match(repository, /uploadIntents: Map<string, UploadIntentRecord>/);
  assert.match(repository, /ownsSession\(sessionId, ownerId\)/);
  assert.match(repository, /ownsUploadIntent\(uploadIntentId, ownerId\)/);
  assert.doesNotMatch(repository, /findById\(sessionId: string\):/);
  assert.doesNotMatch(repository, /findUploadIntent\(uploadIntentId: string\):/);
});

test("executable migration and web upload contract use one private bucket policy", () => {
  const migration = readRepo("supabase/migrations/001_acttub_slice1_schema.sql");
  const types = readWeb("src/lib/api/types.ts");
  const config = readWeb("src/lib/config/env.ts");
  const service = readWeb("src/server/services/coach-session-service.ts");

  assert.match(migration, /insert into storage\.buckets[\s\S]*'coach-takes'[\s\S]*false[\s\S]*314572800[\s\S]*array\['video\/mp4', 'video\/quicktime'\]/);
  assert.match(migration, /bucket_id = 'coach-takes'[\s\S]*owner = auth\.uid\(\)[\s\S]*storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.match(types, /storageBucket: "local-dev" \| "coach-takes"/);
  assert.match(config, /NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET \?\? "coach-takes"/);
  assert.match(service, /storageBucket: "coach-takes"/);
});
