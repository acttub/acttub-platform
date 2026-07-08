import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const appRoot = path.join(repoRoot, "apps/web");

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readWeb(relativePath) {
  return readRepo(path.join("apps/web", relativePath));
}

function collectRouteFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) return collectRouteFiles(absolutePath);
    return entry === "route.ts" ? [absolutePath] : [];
  });
}

function protectedRouteFiles() {
  const apiRoot = path.join(appRoot, "src/app/api/v1");

  return collectRouteFiles(apiRoot)
    .map((file) => path.relative(appRoot, file))
    .filter(
      (file) =>
        file.startsWith("src/app/api/v1/practice-sessions") ||
        file.startsWith("src/app/api/v1/sessions") ||
        file.startsWith("src/app/api/v1/practice-upload-intents"),
    );
}

test("practice APIs are explicitly auth, terms, and owner gated", () => {
  const routes = protectedRouteFiles();
  assert.ok(routes.length > 0, "expected protected API routes");

  const missingGate = [];
  const missingOwner = [];
  const serviceCallPattern =
    /coachSessionService\.(?:listSessions|createSession|getSession|softHideSession|createSignedVideoUrl|getSignedVideoUrl|updateObservation|createTurn|saveValidationMetrics|createSummary|finalizeUploadIntent)\([^;\n]*\)/g;

  for (const file of routes) {
    const source = readWeb(file);

    if (!source.includes("requireApiTermsAccepted") && !source.trim().startsWith("export { POST }")) {
      missingGate.push(file);
    }

    for (const call of source.match(serviceCallPattern) ?? []) {
      if (!call.includes("auth.userId")) {
        missingOwner.push(`${file}: ${call}`);
      }
    }
  }

  assert.deepEqual(missingGate, []);
  assert.deepEqual(missingOwner, []);
});

test("upload sessions flow through a finalized owner-bound upload intent", () => {
  const service = readWeb("src/server/services/coach-session-service.ts");
  const finalizeRoute = readWeb("src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  const practiceFlow = readWeb("src/features/practice/practice-flow.tsx");

  assert.match(service, /Upload sessions must be created from a finalized upload intent/);
  assert.match(service, /Upload intent must be finalized before session creation/);
  assert.match(service, /Must match the upload intent storage path/);
  assert.match(service, /findUploadIntent\(input\.uploadIntentId, userId\)/);
  assert.match(
    finalizeRoute,
    /finalizeUploadIntent\(\s*uploadIntentId,\s*payload,\s*auth\.userId/s,
  );
  assert.match(practiceFlow, /createPracticeUploadIntent/);
  assert.match(practiceFlow, /finalizePracticeUploadIntent/);
  assert.match(practiceFlow, /getSupabaseBrowserClient/);
});

test("mock persistence keeps owner scope on sessions and upload intents", () => {
  const repository = readWeb("src/server/repositories/mock-coach-session-repository.ts");

  assert.match(repository, /sessionOwners: Map<string, string>/);
  assert.match(repository, /uploadIntents: Map<string, StoredUploadIntentRecord>/);
  assert.match(repository, /sessionOwners\.get\(sessionId\) === ownerId/);
  assert.match(repository, /uploadIntent\.userId !== ownerUserId/);
  assert.match(repository, /saveUploadIntent\([\s\S]*ownerUserId: string/);
  assert.match(repository, /markUploadIntentFinalized\([\s\S]*ownerUserId: string/);
});

test("executable migration and web upload contract use one private insert-only policy", () => {
  const migration = readRepo("supabase/migrations/001_acttub_slice1_schema.sql");
  const types = readWeb("src/lib/api/types.ts");
  const config = readWeb("src/lib/config/env.ts");
  const service = readWeb("src/server/services/coach-session-service.ts");

  assert.match(
    migration,
    /insert into storage\.buckets[\s\S]*'practice-videos'[\s\S]*false[\s\S]*314572800[\s\S]*array\['video\/mp4', 'video\/quicktime'\]/,
  );
  assert.match(
    migration,
    /create policy "practice videos insert via active upload intent"[\s\S]*for insert[\s\S]*to authenticated[\s\S]*bucket_id = 'practice-videos'[\s\S]*owner = auth\.uid\(\)[\s\S]*\(storage\.foldername\(name\)\)\[1\] = 'users'[\s\S]*\(storage\.foldername\(name\)\)\[2\] = auth\.uid\(\)::text[\s\S]*\(storage\.foldername\(name\)\)\[3\] = 'practice-sessions'[\s\S]*storage\.filename\(name\) in \('take\.mp4', 'take\.mov'\)[\s\S]*public\.is_active_acttub_profile\(auth\.uid\(\)\)[\s\S]*exists \([\s\S]*from public\.upload_intents ui[\s\S]*ui\.user_id = auth\.uid\(\)[\s\S]*ui\.status = 'created'[\s\S]*ui\.expected_storage_bucket = storage\.objects\.bucket_id[\s\S]*ui\.expected_storage_path = storage\.objects\.name[\s\S]*ui\.expires_at > now\(\)/,
  );
  assert.doesNotMatch(migration, /storage_actor_(?:read|update|delete)/);
  assert.doesNotMatch(migration, /for select using \(\s*bucket_id = 'practice-videos'/);
  assert.doesNotMatch(migration, /for update using \(\s*bucket_id = 'practice-videos'/);
  assert.doesNotMatch(migration, /for delete using \(\s*bucket_id = 'practice-videos'/);
  assert.match(types, /storageBucket: "local-dev" \| "practice-videos"/);
  assert.match(config, /NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET \?\? "practice-videos"/);
  assert.match(service, /storageBucket: config\.video\.bucket as PracticeUploadIntentDto\["storageBucket"\]/);
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
