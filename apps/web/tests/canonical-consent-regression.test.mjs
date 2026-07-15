import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

test("current required and AI consent gate access while internal review remains optional", () => {
  const authContext = read("src/server/services/auth-context.ts");

  assert.match(authContext, /current_acttub_terms_version/);
  assert.match(authContext, /current_acttub_ai_processing_consent_version/);
  assert.match(authContext, /required_consent_version === versions\.requiredConsentVersion/);
  assert.match(authContext, /Boolean\(data\.required_consent_at\)/);
  assert.match(authContext, /ai_processing_consent_version === versions\.aiProcessingConsentVersion/);
  assert.match(authContext, /Boolean\(data\.ai_processing_consent_at\)/);
  assert.doesNotMatch(authContext, /Boolean\(data\.internal_review_consent_at\)/);
});

test("the executable migration defines the canonical consent contract", () => {
  const migration = read("../../supabase/migrations/012_canonical_consent_contract.sql");

  assert.match(migration, /current_acttub_ai_processing_consent_version/);
  assert.match(migration, /required_consent_version text/);
  assert.match(migration, /required_consent_at timestamptz/);
  assert.match(migration, /ai_processing_consent_version text/);
  assert.match(migration, /ai_processing_consent_at timestamptz/);
  assert.match(migration, /internal_review_consent boolean not null default false/);
  assert.doesNotMatch(
    migration,
    /active_profile_requires_current_consent[\s\S]*internal_review_consent(?:_at)? is not null/,
  );
});

test("terms acceptance writes the canonical consent shape required by Supabase", () => {
  const authContext = read("src/server/services/auth-context.ts");
  const route = read("src/app/api/v1/terms/acceptances/route.ts");
  const migration = read("../../supabase/migrations/014_lock_profile_and_terms_owners.sql");

  assert.match(authContext, /p_required_consent_version: versions\.requiredConsentVersion/);
  assert.match(authContext, /p_ai_processing_consent_version: versions\.aiProcessingConsentVersion/);
  assert.match(authContext, /p_internal_review_consent: internalReviewConsent/);
  assert.match(authContext, /p_accepted_at: acceptedAt/);
  assert.match(migration, /required_consent_at = p_accepted_at/);
  assert.match(migration, /ai_processing_consent_at = p_accepted_at/);
  assert.match(route, /body\.requiredConsentAccepted !== true/);
  assert.match(route, /body\.aiProcessingConsentAccepted !== true/);
  assert.match(route, /recordTermsAcceptance\(auth, body\.internalReviewConsent === true\)/);
});

test("terms gate requires both mandatory choices and leaves internal review off by default", () => {
  const source = read("src/features/practice/terms-gate.tsx");

  assert.match(source, /const \[serviceConsent, setServiceConsent\] = useState\(false\)/);
  assert.match(source, /const \[aiProcessingConsent, setAiProcessingConsent\] = useState\(false\)/);
  assert.match(source, /const \[internalReviewConsent, setInternalReviewConsent\] = useState\(false\)/);
  assert.match(source, /!serviceConsent \|\| !aiProcessingConsent/);
  assert.match(source, /선택 동의는 꺼진 상태여도 서비스를 이용할 수 있어요/);
});
