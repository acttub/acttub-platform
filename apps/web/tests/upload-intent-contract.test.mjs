import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");
const service = () => read("src/server/services/coach-session-service.ts");

test("upload intent creation validates MIME, size, and owner-scoped path", () => {
  const source = service();
  assert.match(source, /allowedUploadMimeTypes = new Set\(\["video\/mp4", "video\/quicktime"\]\)/);
  assert.match(source, /sizeBytes[\s\S]*<= 0[\s\S]*> maxUploadBytes/);
  assert.match(source, /storagePath: `users\/\$\{userId\}\/practice-sessions\/\$\{sessionId\}\/take\.\$\{extension\}`/);
});

test("finalize route binds path uploadIntentId to auth owner", () => {
  const source = read("src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  assert.match(source, /const \{ uploadIntentId \} = await context\.params/);
  assert.match(source, /finalizeUploadIntent\(uploadIntentId, payload, auth\.userId\)/);
});

test("verification service rejects missing, expired, and mismatched-path intents before session creation", () => {
  const source = service();
  assert.match(source, /findUploadIntent\(uploadIntentId, userId\)/);
  assert.match(source, /Upload intent was not found/);
  assert.match(source, /Upload intent has expired/);
  assert.match(source, /storagePath !== uploadIntent\.storagePath/);
  assert.match(source, /supabaseCoachSessionRepository\.finalizeUploadIntent\(uploadIntent\.intent\)/);
  assert.doesNotMatch(source, /markUploadIntentFinalized|status: "finalized"/);
});

test("upload_url session creation requires matching created Supabase upload intent", () => {
  const source = service();
  assert.match(source, /validatedMedium !== "upload_url"/);
  assert.match(source, /if \(!input\.uploadIntentId\)/);
  assert.match(source, /uploadIntent\.status !== "created"/);
  assert.match(source, /Must match the upload intent sessionId/);
  assert.match(source, /Must match the upload intent storage path/);
  assert.match(source, /await verifySupabaseStorageObject\(uploadIntent\.intent\)/);
});
