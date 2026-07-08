import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const gatedPracticeRoutes = [
  "apps/web/src/app/api/v1/practice-sessions/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/turns/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/observations/[observationId]/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/result/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/visibility/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/hide/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/metrics/route.ts",
  "apps/web/src/app/api/v1/practice-sessions/[sessionId]/signed-video-url/route.ts",
  "apps/web/src/app/api/v1/practice-upload-intents/route.ts",
  "apps/web/src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts",
];

test("practice APIs require API terms auth and pass owner identity to services", () => {
  for (const route of gatedPracticeRoutes) {
    const source = read(route);
    assert.match(source, /require(Api)?TermsAccepted/, `${route} must enforce auth/terms gate`);
  }

  const service = read("apps/web/src/server/services/coach-session-service.ts");
  assert.match(service, /listSessions\(userId: string\)/);
  assert.match(service, /createSession\(payload: unknown, userId/);
  assert.match(service, /finalizeUploadIntent\([\s\S]*uploadIntentId: string,[\s\S]*userId: string/);
  assert.match(service, /findUploadIntent\(uploadIntentId, userId\)/);
  assert.match(service, /status !== "finalized"/);

  const repository = read("apps/web/src/server/repositories/mock-coach-session-repository.ts");
  assert.match(repository, /ownsSession/);
  assert.match(repository, /listVisible\(userId: string\)/);
  assert.match(repository, /findById\(sessionId: string, userId: string\)/);
});

test("legacy sessions routes cannot bypass hardened practice route handlers", () => {
  const aliases = [
    "apps/web/src/app/api/v1/sessions/route.ts",
    "apps/web/src/app/api/v1/sessions/[sessionId]/route.ts",
    "apps/web/src/app/api/v1/sessions/[sessionId]/turns/route.ts",
    "apps/web/src/app/api/v1/sessions/[sessionId]/observations/[observationId]/route.ts",
    "apps/web/src/app/api/v1/sessions/[sessionId]/summary/route.ts",
  ];

  for (const alias of aliases) {
    const source = read(alias);
    assert.match(source, /requireApiTermsAccepted/, `${alias} must enforce the API terms gate`);
    assert.match(source, /auth\.userId/, `${alias} must pass auth.userId into service owner checks`);
  }
});

test("sensitive JSON responses use shared no-store helpers", () => {
  const authSession = read("apps/web/src/app/api/v1/auth/session/route.ts");
  assert.match(authSession, /jsonResponse/);
  assert.doesNotMatch(authSession, /NextResponse\.json/);

  const uploadFinalize = read("apps/web/src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  assert.match(uploadFinalize, /jsonResponse/);
  assert.doesNotMatch(uploadFinalize, /NextResponse\.json/);
});

test("upload UI goes through create intent and finalize before creating upload session", () => {
  const flow = read("apps/web/src/features/practice/practice-flow.tsx");
  assert.match(flow, /createPracticeUploadIntent/);
  assert.match(flow, /finalizePracticeUploadIntent/);
  assert.match(flow, /uploadIntentId: uploadIntent\.uploadIntentId/);
  assert.match(flow, /storagePath: finalizedUpload\.storagePath/);
});

test("migration uses private practice-videos insert-only storage contract", () => {
  const migration = read("supabase/migrations/001_acttub_slice1_schema.sql");
  assert.match(migration, /public\.profiles/);
  assert.match(migration, /public\.upload_intents/);
  assert.match(migration, /'practice-videos'/);
  assert.match(migration, /active upload intent[\s\S]*for insert/);
  assert.doesNotMatch(migration, /'coach-takes'/);
  assert.doesNotMatch(migration, /on storage\.objects for select/);
  assert.doesNotMatch(migration, /on storage\.objects for update/);
  assert.doesNotMatch(migration, /on storage\.objects for delete/);
});
