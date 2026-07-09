import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");
const service = () => read("src/server/services/coach-session-service.ts");

test("Slice 1 session creation rejects every non-upload bypass and requires a verified Supabase intent", () => {
  const source = service();

  assert.match(source, /if \(validatedMedium !== "upload_url"\) \{[\s\S]*Slice 1 requires medium to be upload_url/);
  assert.match(source, /if \(!input\.uploadIntentId\) \{[\s\S]*Upload sessions must be created from a verified Supabase upload intent/);
  assert.match(source, /uploadIntent\.status !== "created"/);
  assert.match(source, /const videoUrl = videoRefForUploadIntent\(uploadIntent\.intent\)/);

  const flow = read("src/features/practice/practice-flow.tsx");
  assert.match(flow, /medium: "upload_url"/);
  assert.doesNotMatch(flow, /<option value="youtube_url">/);
  assert.doesNotMatch(flow, /<option value="text_only">/);
});

test("upload verification checks exact storage object semantics and fails closed for Supabase", () => {
  const source = service();

  assert.match(source, /const verifySupabaseStorageObject = async/);
  assert.match(source, /createSupabaseAdminClient\(\)/);
  assert.match(source, /Supabase storage verification requires SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /\.from\(uploadIntent\.storageBucket\)[\s\S]*\.list\(directory, \{ limit: 100, search: fileName \}\)/);
  assert.match(source, /object\?\.name === fileName/);
  assert.match(source, /const storageObjectMimeType = \(object: Record<string, unknown>\): string \| null =>/);
  assert.match(source, /const storageObjectSizeBytes = \(object: Record<string, unknown>\): number \| null =>/);
  assert.match(source, /metadata\?\.\[key\] !== undefined[\s\S]*object\[key\] !== undefined/);
  assert.match(source, /"mimetype",[\s\S]*"mimeType",[\s\S]*"contentType",[\s\S]*"content_type",[\s\S]*"mime_type"/);
  assert.match(source, /"size", "sizeBytes", "size_bytes"/);
  assert.match(source, /const parsedSize = Number\(size\)/);
  assert.match(source, /actualMimeType !== uploadIntent\.fileMetadata\.mimeType/);
  assert.match(source, /actualSizeBytes !== uploadIntent\.fileMetadata\.sizeBytes/);
  assert.match(source, /Uploaded storage object metadata does not match the upload intent/);
  assert.match(source, /validateExpectedStoragePath\(uploadIntent\.intent, storagePath, userId\)/);
  assert.match(source, /await verifySupabaseStorageObject\(uploadIntent\.intent\)/);
  assert.match(source, /storagePath !== uploadIntent\.storagePath\s*\|\|[\s\S]*!storagePath\.startsWith\(expectedPrefix\)[\s\S]*!allowedNames\.has\(fileName\)/);
  assert.doesNotMatch(source, new RegExp("local" + "-dev:\\/\\/"));
});

test("private video playback uses owner-checked admin signed URLs, never raw stored refs", () => {
  const source = service();
  const videoRoute = read("src/app/api/v1/practice-sessions/[sessionId]/video-url/route.ts");
  const signedRoute = read("src/app/api/v1/practice-sessions/[sessionId]/signed-video-url/route.ts");

  assert.match(source, /findById\(sessionId, userId\)/);
  assert.match(source, /\.from\(config\.video\.bucket\)[\s\S]*\.createSignedUrl\(storagePath, expiresInSeconds\)/);
  assert.match(source, /Supabase signed playback requires verified private storage/);
  assert.doesNotMatch(source, /signedUrl: session\.take\.videoUrl/);
  assert.match(videoRoute, /await coachSessionService\.createSignedVideoUrl\(sessionId, auth\.userId\)/);
  assert.match(signedRoute, /await coachSessionService\.getSignedVideoUrl\(sessionId, auth\.userId\)/);
});

test("completed sessions reject later observation, turn, metrics, and duplicate result mutations", () => {
  const source = service();

  assert.match(source, /const assertSessionMutable = \(session: CoachSessionDto, action: string\): void => \{/);
  assert.match(source, /session\.status === "END"/);
  assert.match(source, /assertSessionMutable\(existingSession, "update observations"\)/);
  assert.match(source, /assertSessionMutable\(session, "create new turns"\)/);
  assert.match(source, /assertSessionMutable\(session, "mutate validation metrics"\)/);
  assert.match(source, /assertSessionMutable\(session, "create duplicate results"\)/);
});

test("legacy observation alias preserves service argument order and clients use canonical endpoints", () => {
  const legacyObservation = read("src/app/api/v1/sessions/[sessionId]/observations/[observationId]/route.ts");
  const sessionClient = read("src/lib/api/sessions.ts");

  assert.match(
    legacyObservation,
    /updateObservation\(\s*sessionId,\s*auth\.userId,\s*observationId,\s*payload,\s*\)/,
  );
  assert.doesNotMatch(
    legacyObservation,
    /updateObservation\(\s*sessionId,\s*observationId,\s*payload,\s*auth\.userId/s,
  );
  assert.match(sessionClient, /\/api\/v1\/practice-sessions\/\$\{sessionId\}\/observations\/\$\{observationId\}/);
  assert.match(sessionClient, /\/api\/v1\/practice-sessions\/\$\{sessionId\}\/turns/);
  assert.match(sessionClient, /\/api\/v1\/practice-sessions\/\$\{sessionId\}\/result/);
});

test("local in-memory practice persistence is not present", () => {
  assert.equal(existsSync(path.join(appRoot, "src/server/repositories/" + "mo" + "ck-coach-session-repository.ts")), false);
  assert.doesNotMatch(service(), new RegExp("mo" + "ckCoachSessionRepository|local" + "-dev:\\/\\/"));
});
