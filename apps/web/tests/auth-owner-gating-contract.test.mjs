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

test("Google OAuth sign-in creates a pending profile without overwriting existing users", () => {
  const login = read("src/app/auth/login/route.ts");
  const callback = read("src/app/auth/callback/route.ts");
  const authContext = read("src/server/services/auth-context.ts");

  assert.match(login, /getAuthContext/);
  assert.match(login, /existingContext\.termsAccepted \? next : "\/terms"/);
  assert.match(login, /NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(login, /status: 503/);
  assert.doesNotMatch(login, /if \(!config\.supabase\.isConfigured\) \{\s*redirect\("\/terms"\)/);
  assert.match(callback, /const context = await getAuthContext\(\)/);
  assert.match(authContext, /export async function ensurePendingProfile/);
  assert.match(authContext, /\.from\("profiles"\)\.insert/);
  assert.match(authContext, /status: "pending_terms"/);
  assert.match(authContext, /isDuplicateProfileError/);
  assert.match(authContext, /await ensurePendingProfile\({[\s\S]*userId: data\.user\.id/);
});

test("Supabase public key accepts current publishable-key env name with anon fallback", () => {
  const env = read("src/lib/config/env.ts");

  assert.match(env, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(env, /process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("practice entrypoints require authentication before use", () => {
  const landing = read("src/app/page.tsx");
  const proxy = read("src/lib/supabase/proxy.ts");
  const practiceFlow = read("src/features/practice/practice-flow.tsx");
  const termsGate = read("src/features/practice/terms-gate.tsx");

  assert.match(landing, /import \{ redirect \} from "next\/navigation"/);
  assert.match(landing, /import \{ getAuthContext \} from "@\/server\/services\/auth-context"/);
  assert.match(landing, /const auth = await getAuthContext\(\)/);
  assert.match(landing, /redirect\(auth\.termsAccepted \? "\/home" : "\/terms"\)/);
  assert.match(landing, /const practiceLoginHref = "\/auth\/login\?next=\/practice\/new"/);
  assert.doesNotMatch(landing, /href="\/practice"/);
  assert.match(proxy, /isProtectedPracticePath\(request\.nextUrl\.pathname\)/);
  assert.match(proxy, /PROTECTED_ROUTE_PATHS = \["\/home", "\/practice\/new", "\/practice\/history"\]/);
  assert.match(proxy, /supabase\.auth\.getClaims\(\)/);
  assert.match(proxy, /if \(!config\.supabase\.isConfigured\) \{[\s\S]*redirectToLogin\(request\)/);
  assert.match(proxy, /return redirectToLogin\(request\)/);
  assert.match(practiceFlow, /encodeURIComponent\(entryPath\[entry\]\)/);
  assert.match(termsGate, /window\.location\.href = "\/auth\/login\?next=\/home"/);
  assert.match(termsGate, /window\.location\.href = "\/home"/);
});


test("Supabase API terms gate fails closed without local auth bypass", () => {
  const authContext = read("src/server/services/auth-context.ts");
  const proxy = read("src/lib/supabase/proxy.ts");

  assert.doesNotMatch(authContext, new RegExp("ACTTUB_ENABLE_LOCAL_DEV_AUTH_BYPASS|" + "local" + "-dev|hasAcceptedTermsCookie"));
  assert.match(authContext, /if \(!config\.supabase\.isConfigured\) return null/);
  assert.match(authContext, /mode: "supabase"[\s\S]*termsAccepted: await hasPersistedTermsAcceptance\(data\.user\.id\)/);
  assert.match(proxy, /if \(!config\.supabase\.isConfigured\) \{[\s\S]*return shouldRequireLogin \? redirectToLogin\(request\) : response/);
});

test("signed video URLs require current AI consent at the reusable service boundary", () => {
  const authContext = read("src/server/services/auth-context.ts");
  const service = read("src/server/services/coach-session-service.ts");
  const canonicalRoute = read(
    "src/app/api/v1/practice-sessions/[sessionId]/signed-video-url/route.ts",
  );
  const compatibilityRoute = read(
    "src/app/api/v1/practice-sessions/[sessionId]/video-url/route.ts",
  );

  assert.match(authContext, /export async function requireCurrentAiProcessingConsent/);
  assert.match(authContext, /current_acttub_terms_version/);
  assert.match(authContext, /current_acttub_ai_processing_consent_version/);
  assert.match(authContext, /status, required_consent_version, required_consent_at, ai_processing_consent_version, ai_processing_consent_at/);
  assert.match(authContext, /profile\?\.status === "active"/);
  assert.match(authContext, /profile\.required_consent_version === termsVersionResult\.data/);
  assert.match(authContext, /Boolean\(profile\.required_consent_at\)/);
  assert.match(authContext, /profile\.ai_processing_consent_version === aiConsentVersionResult\.data/);
  assert.match(authContext, /Boolean\(profile\.ai_processing_consent_at\)/);
  const currentConsentGate = authContext.slice(
    authContext.indexOf("export async function requireCurrentAiProcessingConsent"),
    authContext.indexOf("function isDuplicateProfileError"),
  );
  assert.doesNotMatch(
    currentConsentGate,
    /\bconsent_version\b|terms_accepted_at|privacy_accepted_at|internal_review_consent_at/,
  );

  const ownerRead = service.indexOf("const session = await readSessionForOwner(sessionId, userId)");
  const consentGate = service.indexOf("await requireCurrentAiProcessingConsent(userId)", ownerRead);
  const signedUrlCreation = service.indexOf(".createSignedUrl(storagePath, expiresInSeconds)", consentGate);
  assert.ok(ownerRead >= 0 && consentGate > ownerRead && signedUrlCreation > consentGate);
  assert.match(canonicalRoute, /getSignedVideoUrl\(sessionId, auth\.userId\)/);
  assert.match(compatibilityRoute, /createSignedVideoUrl\(sessionId, auth\.userId\)/);
});
