const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ACTING_API_BASE_URL",
  "ACTING_API_KEY",
];

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!supabasePublicKey) {
  missingEnvironment.push(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
  );
}
if (missingEnvironment.length) {
  throw new Error(`Missing required environment: ${missingEnvironment.join(", ")}`);
}

const videoBucket = process.env.NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET?.trim() || "practice-videos";
if (videoBucket !== "practice-videos") {
  throw new Error("NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET must be practice-videos.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const actingApiUrl = process.env.ACTING_API_BASE_URL.replace(/\/$/u, "");
const actingApiKey = process.env.ACTING_API_KEY;

async function fetchWithTimeout(label, input, init = {}) {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`${label} request failed.`, { cause: error });
  }
}

const schemaResponse = await fetchWithTimeout("Supabase schema preflight", `${supabaseUrl}/rest/v1/`, {
  headers: {
    Accept: "application/openapi+json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});
if (!schemaResponse.ok) {
  throw new Error(`Supabase schema preflight failed with HTTP ${schemaResponse.status}.`);
}

const schema = await schemaResponse.json();
const requiredPaths = [
  "/rpc/acttub_finalize_upload_intent",
  "/rpc/acttub_create_acting_session",
  "/rpc/acttub_complete_analysis",
  "/scene_summaries",
  "/practice_upstream_operations",
];
const missingPaths = requiredPaths.filter((path) => !schema.paths?.[path]);
const hasDuration = Boolean(schema.definitions?.upload_intents?.properties?.duration_ms);
if (missingPaths.length || !hasDuration) {
  const missing = [...missingPaths, ...(!hasDuration ? ["upload_intents.duration_ms"] : [])];
  throw new Error(`Supabase acting schema is behind: ${missing.join(", ")}`);
}

const healthResponse = await fetchWithTimeout("acting-api health check", `${actingApiUrl}/health`);
if (!healthResponse.ok) {
  throw new Error(`acting-api health check failed with HTTP ${healthResponse.status}.`);
}

const authProbe = await fetchWithTimeout("acting-api authentication preflight", `${actingApiUrl}/coach/start`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": actingApiKey,
  },
  body: "{}",
});
if (authProbe.status !== 422) {
  throw new Error(`acting-api authentication preflight expected HTTP 422, received ${authProbe.status}.`);
}

console.log("Acting runtime preflight passed.");
