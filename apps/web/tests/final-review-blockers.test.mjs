import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const appRoot = path.join(repoRoot, "apps/web");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectRouteFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return collectRouteFiles(absolutePath);
    }

    return entry === "route.ts" ? [absolutePath] : [];
  });
}

test("practice APIs are explicitly auth, terms, and owner gated", () => {
  const apiRoot = path.join(appRoot, "src/app/api/v1");
  const protectedRoutes = collectRouteFiles(apiRoot)
    .map((file) => path.relative(appRoot, file))
    .filter(
      (file) =>
        file.startsWith("src/app/api/v1/practice-sessions") ||
        file.startsWith("src/app/api/v1/sessions") ||
        file.startsWith("src/app/api/v1/practice-upload-intents"),
    );

  assert.ok(protectedRoutes.length > 0, "expected protected API routes");

  const missingGate = protectedRoutes.filter((file) => {
    const source = read(path.join("apps/web", file));
    return (
      !source.includes("requireApiTermsAccepted") &&
      !source.trim().startsWith("export { POST }")
    );
  });

  assert.deepEqual(missingGate, []);
});

test("upload sessions must flow through a finalized owner-bound upload intent", () => {
  const service = read("apps/web/src/server/services/coach-session-service.ts");
  const finalizeRoute = read(
    "apps/web/src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts",
  );
  const practiceFlow = read("apps/web/src/features/practice/practice-flow.tsx");

  assert.match(
    service,
    /Upload sessions must be created from a finalized upload intent/,
  );
  assert.match(
    service,
    /Upload intent must be finalized before session creation/,
  );
  assert.match(service, /Must match the active upload intent storage path/);
  assert.match(
    finalizeRoute,
    /finalizeUploadIntent\(\s*uploadIntentId,\s*payload,\s*auth\.userId/s,
  );
  assert.match(practiceFlow, /createPracticeUploadIntent/);
  assert.match(practiceFlow, /finalizePracticeUploadIntent/);
});

test("mock persistence keeps owner scope out of public DTOs", () => {
  const repository = read(
    "apps/web/src/server/repositories/mock-coach-session-repository.ts",
  );

  assert.match(repository, /ownerId: string/);
  assert.match(repository, /session\.ownerId === ownerId/);
  assert.match(repository, /const \{ ownerId: _ownerId, \.\.\.dto \}/);
});

test("executable migration matches private practice-videos upload-intent contract", () => {
  const migration = read("supabase/migrations/001_acttub_slice1_schema.sql");

test("executable migration and web upload contract use one private bucket policy", () => {
  const migration = readRepo("supabase/migrations/001_acttub_slice1_schema.sql");
  const types = readWeb("src/lib/api/types.ts");
  const config = readWeb("src/lib/config/env.ts");
  const service = readWeb("src/server/services/coach-session-service.ts");

  assert.match(migration, /insert into storage\.buckets[\s\S]*'practice-videos'[\s\S]*false[\s\S]*314572800[\s\S]*array\['video\/mp4', 'video\/quicktime'\]/);
  assert.match(migration, /bucket_id = 'practice-videos'[\s\S]*owner = auth\.uid\(\)[\s\S]*storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.match(types, /storageBucket: "local-dev" \| "practice-videos"/);
  assert.match(config, /NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET \?\? "practice-videos"/);
  assert.match(service, /storageBucket: "practice-videos"/);
  assert.doesNotMatch(migration, /storage_actor_(?:read|update|delete)/);
  assert.doesNotMatch(migration, /for select using \(\s*bucket_id = 'practice-videos'/);
  assert.doesNotMatch(migration, /for update using \(\s*bucket_id = 'practice-videos'/);
  assert.doesNotMatch(migration, /for delete using \(\s*bucket_id = 'practice-videos'/);
});


test("upload intent API response and client paths stay on the intent/finalize contract", () => {
  const createRoute = readWeb("src/app/api/v1/practice-upload-intents/route.ts");
  const sessionClient = readWeb("src/lib/api/sessions.ts");
  const practiceClient = readWeb("src/lib/api/practice.ts");

  assert.match(createRoute, /jsonResponse\(\{ uploadIntent: result \}, \{ status: 201 \}\)/);
  assert.match(sessionClient, /fetch\("\/api\/v1\/practice-upload-intents"/);
  assert.match(sessionClient, /fetch\(`\/api\/v1\/practice-upload-intents\/\$\{uploadIntentId\}\/finalize`/);
  assert.match(practiceClient, /fetch\("\/api\/v1\/practice-upload-intents"/);
});
