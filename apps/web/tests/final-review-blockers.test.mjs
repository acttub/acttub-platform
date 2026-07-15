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

test("upload sessions flow through an owner-bound Supabase upload intent", () => {
  const service = readWeb("src/server/services/coach-session-service.ts");
  const finalizeRoute = readWeb("src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  const practiceFlow = readWeb("src/features/practice/practice-flow.tsx");

  assert.match(service, /Upload sessions must be created from a verified Supabase upload intent/);
  assert.match(service, /Upload intent is not available for session creation/);
  assert.match(service, /uploadIntent\.status !== "created"/);
  assert.match(service, /await verifySupabaseStorageObject\(uploadIntent\.intent\);[\s\S]*supabaseCoachSessionRepository\.createSession\(\{[\s\S]*uploadIntent: uploadIntent\.intent/s);
  assert.match(service, /Must match the upload intent storage path/);
  assert.match(service, /readUploadIntentForOwner\(input\.uploadIntentId, userId\)/);
  assert.match(
    finalizeRoute,
    /finalizeUploadIntent\(\s*uploadIntentId,\s*payload,\s*auth\.userId/s,
  );
  assert.match(practiceFlow, /createPracticeUploadIntent/);
  assert.match(practiceFlow, /finalizePracticeUploadIntent/);
  assert.match(practiceFlow, /getSupabaseBrowserClient/);
});

test("practice persistence has no local in-memory repository", () => {
  const service = readWeb("src/server/services/coach-session-service.ts");
  const repository = readWeb("src/server/repositories/supabase-coach-session-repository.ts");

  assert.match(service, /requireSupabaseConfigured/);
  assert.match(service, /supabaseCoachSessionRepository/);
  assert.match(repository, /\.eq\("user_id", userId\)/);
  assert.doesNotMatch(service, new RegExp("mo" + "ckCoachSessionRepository|globalThis\\.__acttub"));
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
  assert.match(types, /storageBucket: "practice-videos"/);
  assert.match(config, /NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET \?\? "practice-videos"/);
  assert.match(service, /storageBucket: "practice-videos"/);
});


test("visibility PATCH requires valid JSON while POST hide remains bodyless", () => {
  const visibilityRoute = readWeb("src/app/api/v1/practice-sessions/[sessionId]/visibility/route.ts");
  const hideRoute = readWeb("src/app/api/v1/practice-sessions/[sessionId]/hide/route.ts");

  assert.match(visibilityRoute, /await readBoundedJson\(request\)/);
  assert.doesNotMatch(visibilityRoute, /request\.json\(\)/);
  assert.doesNotMatch(visibilityRoute, /\{\s*hidden:\s*true\s*\}/);
  assert.match(visibilityRoute, /body\.hidden !== true/);
  assert.match(visibilityRoute, /handleApiError\(error\)/);

  assert.match(hideRoute, /POST\(_request: Request/);
  assert.doesNotMatch(hideRoute, /_request\.json\(\)/);
  assert.match(hideRoute, /softHideSession\(sessionId, auth\.userId\)/);
});

test("terms acceptance rejects invalid JSON but preserves form and empty body paths", () => {
  const route = readWeb("src/app/api/v1/terms/acceptances/route.ts");

  assert.match(route, /contentType\.includes\("application\/json"\)[\s\S]*return \(await request\.json\(\)\) as AcceptTermsBody/);
  assert.doesNotMatch(route, /request\.json\(\)\.catch/);
  assert.match(route, /contentType\.includes\("application\/x-www-form-urlencoded"\)[\s\S]*await request\.formData\(\)/);
  assert.match(route, /requiredConsentAccepted: formData\.get\("requiredConsentAccepted"\) === "true"/);
  assert.match(route, /aiProcessingConsentAccepted: formData\.get\("aiProcessingConsentAccepted"\) === "true"/);
  assert.match(route, /internalReviewConsent: formData\.get\("internalReviewConsent"\) === "true"/);
  assert.match(route, /return \{\};/);
  assert.match(route, /handleApiError\(error\)/);
});



test("docs capture bounded direct upload fallback and future TUS hardening", () => {
  const schema = readRepo("docs/SUPABASE_SCHEMA.md");
  const spring = readRepo("docs/SPRING_BOOT_MIGRATION.md");
  const notes = readRepo("docs/supabase/slice1-spring-boot-migration-notes.md");
  const docs = `${schema}\n${spring}\n${notes}`;

  assert.match(docs, /standard `\.upload\(\)` direct storage/);
  assert.match(docs, /without adding a TUS dependency/);
  assert.match(docs, /300 MB bucket limit|300MB bucket\/server-finalization checks/);
  assert.match(docs, /recommends TUS\/resumable uploads for files (?:above|larger than) 6 MB/);
  assert.match(docs, /https:\/\/supabase\.com\/docs\/guides\/storage\/uploads\/standard-uploads/);
  assert.match(docs, /https:\/\/supabase\.com\/docs\/guides\/storage\/uploads\/resumable-uploads/);
  assert.match(docs, /Production .*should add a TUS-capable client/);
});
