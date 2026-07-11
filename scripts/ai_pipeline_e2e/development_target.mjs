import crypto from "node:crypto";

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const PROJECT_HOST_PATTERN = /^([a-z0-9]{20})\.supabase\.co$/u;
const HMAC_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const PROJECT_REF_DOMAIN = Buffer.from("acttub-protected-supabase-project-ref.v1\0", "ascii");
const PLATFORM_TARGET_KEY_DOMAIN = Buffer.from("acttub-protected-platform-target-key.v1\0", "ascii");
const PLATFORM_TARGET_PROOF_DOMAIN = Buffer.from("acttub-protected-platform-target-proof.v1\0", "ascii");

function reject() {
  throw new TypeError("development_target_rejected");
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length < 32 || key.length > 4096) reject();
  return key;
}

export function projectRefFromSupabaseUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) reject();
  let endpoint;
  try { endpoint = new URL(value); } catch { reject(); }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.port !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    !new Set(["", "/"]).has(endpoint.pathname)
  ) reject();
  const match = PROJECT_HOST_PATTERN.exec(endpoint.hostname);
  if (match === null || !PROJECT_REF_PATTERN.test(match[1])) reject();
  return match[1];
}

export function projectRefHmac(key, projectRef) {
  requireKey(key);
  if (typeof projectRef !== "string" || !PROJECT_REF_PATTERN.test(projectRef)) reject();
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(PROJECT_REF_DOMAIN).update(projectRef, "ascii").digest("hex")}`;
}

export function developmentTargetHmac(key, supabaseUrl) {
  return projectRefHmac(key, projectRefFromSupabaseUrl(supabaseUrl));
}

export function assertDevelopmentTarget(key, supabaseUrl, expectedHmac) {
  if (typeof expectedHmac !== "string" || !HMAC_PATTERN.test(expectedHmac)) reject();
  const actual = developmentTargetHmac(key, supabaseUrl);
  if (!crypto.timingSafeEqual(Buffer.from(actual, "ascii"), Buffer.from(expectedHmac, "ascii"))) reject();
  return expectedHmac;
}

export function derivePlatformTargetKey(masterKey) {
  requireKey(masterKey);
  return crypto.createHmac("sha256", masterKey).update(PLATFORM_TARGET_KEY_DOMAIN).digest();
}

export function platformTargetProofHmac(platformKey, projectRef, developmentTarget) {
  requireKey(platformKey);
  if (
    typeof projectRef !== "string" ||
    !PROJECT_REF_PATTERN.test(projectRef) ||
    typeof developmentTarget !== "string" ||
    !HMAC_PATTERN.test(developmentTarget)
  ) reject();
  return `hmac-sha256:${crypto.createHmac("sha256", platformKey).update(PLATFORM_TARGET_PROOF_DOMAIN).update(developmentTarget, "ascii").update("\0", "ascii").update(projectRef, "ascii").digest("hex")}`;
}
