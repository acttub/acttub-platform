import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

const privateRoutes = [
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
  "src/app/api/v1/practice-upload-intents/route.ts",
  "src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts",
  "src/app/api/v1/sessions/route.ts",
  "src/app/api/v1/sessions/[sessionId]/route.ts",
  "src/app/api/v1/sessions/[sessionId]/observations/[observationId]/route.ts",
  "src/app/api/v1/sessions/[sessionId]/summary/route.ts",
  "src/app/api/v1/sessions/[sessionId]/turns/route.ts",
];

test("private practice APIs require current terms before service access", () => {
  const missing = privateRoutes.filter((file) => !read(file).includes("requireApiTermsAccepted"));
  assert.deepEqual(missing, []);
});

test("session APIs pass authenticated owner into service calls", () => {
  const checkedRoutes = privateRoutes.filter((file) => file.includes("practice-sessions") || file.includes("/sessions"));
  const missingOwner = checkedRoutes.filter((file) => {
    const source = read(file);
    if (source.includes("practice-upload-intents/route")) return false;
    return source.includes("coachSessionService") && !source.includes("auth.userId");
  });
  assert.deepEqual(missingOwner, []);
});

test("auth session response is private and varies on credentials", () => {
  const route = read("src/app/api/v1/auth/session/route.ts");
  const http = read("src/app/api/v1/http.ts");
  assert.match(route, /jsonResponse/);
  assert.match(http, /privateNoStoreHeaders/);
  assert.match(read("src/server/http/cache.ts"), /Vary: "Cookie, Authorization"/);
});

test("terms acceptance persists Supabase profile consent when admin client exists", () => {
  const route = read("src/app/api/v1/terms/acceptances/route.ts");
  const authContext = read("src/server/services/auth-context.ts");
  assert.match(route, /recordTermsAcceptance\(auth\)/);
  assert.match(authContext, /createSupabaseAdminClient/);
  assert.match(authContext, /terms_accepted_at/);
  assert.match(authContext, /privacy_accepted_at/);
  assert.match(authContext, /internal_review_consent_at/);
  assert.match(authContext, /status: "active"/);
});
