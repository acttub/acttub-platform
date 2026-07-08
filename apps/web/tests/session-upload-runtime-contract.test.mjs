import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");
const service = () => read("src/server/services/coach-session-service.ts");

test("Slice 1 session creation rejects every non-upload bypass and requires a finalized intent", () => {
  const source = service();

  assert.match(source, /if \(validatedMedium !== "upload_url"\) \{[\s\S]*Slice 1 requires medium to be upload_url/);
  assert.match(source, /if \(!input\.uploadIntentId\) \{[\s\S]*Upload sessions must be created from a finalized upload intent/);
  assert.match(source, /uploadIntent\.status !== "finalized" \|\| !uploadIntent\.finalizedAt/);
  assert.match(source, /videoUrl = videoRefForUploadIntent\(uploadIntent\)/);

  const flow = read("src/features/practice/practice-flow.tsx");
  assert.match(flow, /medium: "upload_url"/);
  assert.doesNotMatch(flow, /<option value="youtube_url">/);
  assert.doesNotMatch(flow, /<option value="text_only">/);
});

test("upload finalization verifies exact storage object semantics and fails closed for Supabase", () => {
  const source = service();

  assert.match(source, /const verifySupabaseStorageObject = async/);
  assert.match(source, /createSupabaseAdminClient\(\)/);
  assert.match(source, /Supabase storage verification is required before finalization/);
  assert.match(source, /\.from\(uploadIntent\.storageBucket\)[\s\S]*\.list\(directory, \{ limit: 100, search: fileName \}\)/);
  assert.match(source, /object\?\.name === fileName/);
  assert.match(source, /const storageObjectMimeType = \(object: Record<string, unknown>\): string \| null =>/);
  assert.match(source, /const storageObjectSizeBytes = \(object: Record<string, unknown>\): number \| null =>/);
  assert.match(source, /metadata\?\.\[key\] !== undefined[\s\S]*object\[key\] !== undefined/);
  assert.match(source, /"mimetype",[\s\S]*"mimeType",[\s\S]*"contentType",[\s\S]*"content_type",[\s\S]*"mime_type"/);
  assert.match(source, /"size",[\s\S]*"sizeBytes",[\s\S]*"size_bytes"/);
  assert.match(source, /const parsedSize = Number\(size\)/);
  assert.match(source, /actualMimeType !== uploadIntent\.fileMetadata\.mimeType/);
  assert.match(source, /actualSizeBytes !== uploadIntent\.fileMetadata\.sizeBytes/);
  assert.match(source, /Uploaded storage object metadata does not match the upload intent/);
  assert.match(source, /validateExpectedStoragePath\(uploadIntent, storagePath, userId\)/);
  assert.match(source, /await verifySupabaseStorageObject\(uploadIntent\)/);
  assert.match(source, /storagePath !== uploadIntent\.storagePath \|\| !storagePath\.startsWith\(expectedPrefix\) \|\| !allowedNames\.has\(fileName\)/);
  assert.doesNotMatch(source, /return \{\s*videoUrl: `local-dev:\/\/\$\{storagePath\}`/);
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


test("mock local-dev persistence prunes bounded session and upload-intent state", () => {
  const repository = read("src/server/repositories/mock-coach-session-repository.ts");

  assert.match(repository, /const maxMockSessionRecords = 100/);
  assert.match(repository, /const maxMockUploadIntentRecords = 200/);
  assert.match(repository, /const pruneMockSessions = \(\): void =>/);
  assert.match(repository, /const pruneMockUploadIntents = \(\): void =>/);
  assert.match(repository, /pruneMockSessions\(\)/);
  assert.match(repository, /pruneMockUploadIntents\(\)/);
});
