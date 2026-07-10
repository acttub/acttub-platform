import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const appRoot = path.join(repoRoot, "apps/web");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const ownerGatedPracticeRoutes = [
  "apps/web/src/app/api/v1/practice-sessions/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/hide/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/metrics/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/observations/[observationId]/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/result/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/signed-video-url/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/turns/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/video-url/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/visibility/route.ts",
  "apps/web/src/app/api/v1/practice-upload-intents/route.ts",
  "apps/web/src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts",
  "apps/web/src/app/api/v1/sessions/route.ts",
  "apps/web/src/app/api/v1/sessions/[sessionId]/route.ts",
  "apps/web/src/app/api/v1/sessions/[sessionId]/observations/[observationId]/route.ts",
  "apps/web/src/app/api/v1/sessions/[sessionId]/summary/route.ts",
  "apps/web/src/app/api/v1/sessions/[sessionId]/turns/route.ts",
];

test("session and upload API routes require accepted terms and pass owner user id", () => {
  for (const route of ownerGatedPracticeRoutes) {
    const source = read(route);
    assert.match(source, /requireApiTermsAccepted/, `${route} must require active terms`);

    if (!route.endsWith("practice-upload-intents/route.ts")) {
      assert.match(source, /auth\.userId/, `${route} must pass auth.userId into service owner checks`);
    }
  }
});

test("upload intent finalize uses path parameter and stored intent validation", () => {
  const route = read("apps/web/src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  assert.match(route, /const \{ uploadIntentId \} = await context\.params/);
  assert.match(route, /finalizeUploadIntent\(uploadIntentId, payload, auth\.userId\)/);

  const service = read("apps/web/src/server/services/coach-session-service.ts");
  assert.match(service, /findUploadIntent\(uploadIntentId, userId\)/);
  assert.match(service, /storagePath !== uploadIntent\.storagePath/);
  assert.match(service, /Upload sessions must be created from a verified Supabase upload intent/);
  assert.match(service, /validatedMedium !== "upload_url"/);
  assert.match(service, /if \(!input\.uploadIntentId\)/);
});

test("practice persistence uses Supabase repository without in-memory fallback", () => {
  const service = read("apps/web/src/server/services/coach-session-service.ts");
  const repository = read("apps/web/src/server/repositories/supabase-coach-session-repository.ts");

  assert.match(service, /requireSupabaseConfigured/);
  assert.match(service, /supabaseCoachSessionRepository/);
  assert.match(repository, /import "server-only"/);
  assert.doesNotMatch(service, new RegExp("mo" + "ckCoachSessionRepository|globalThis\\.__acttub"));
});

test("practice flow uses upload intent lifecycle for uploaded videos", () => {
  const source = read("apps/web/src/features/practice/practice-flow.tsx");
  assert.match(source, /createPracticeUploadIntent/);
  assert.match(source, /finalizePracticeUploadIntent/);
  assert.match(source, /createPipelinePracticeSession/);
  assert.match(source, /uploadIntentId: uploadIntent\.uploadIntentId/);
  assert.match(source, /adultConfirmed: true/);
  assert.match(source, /allParticipantsConfirmed: true/);
  const uploadFlow = source.match(/async function startUpload[\s\S]*?(?=\n  async function refreshPipelineSession)/)?.[0];
  assert.ok(uploadFlow);
  assert.doesNotMatch(uploadFlow, /durationMs:|videoUrl:|termsVersion:|consentVersion:|finalizedAt:/);
  assert.match(uploadFlow, /finalizePracticeUploadIntent\([\s\S]*\{ storagePath: uploadIntent\.storagePath \}/);
});

test("web test script runs focused node tests", () => {
  const packageJson = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
  assert.match(packageJson.scripts.test, /node --test tests\/\*\.test\.mjs/);
});
