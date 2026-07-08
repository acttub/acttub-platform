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

  assert.match(migration, /create table if not exists public\.profiles/);
  assert.match(migration, /create table if not exists public\.upload_intents/);
  assert.match(migration, /'practice-videos'/);
  assert.doesNotMatch(migration, /'coach-takes'/);
  assert.doesNotMatch(migration, /video\/webm/);
  assert.match(migration, /practice videos insert via active upload intent/);
  assert.match(
    migration,
    /Intentionally absent in Slice 1:[\s\S]*no storage\.objects SELECT policy/,
  );
});
