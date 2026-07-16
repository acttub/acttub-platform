import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(webRoot, file), "utf8");

test("public reads and private playback use owner-safe repository boundaries", () => {
  const service = read("src/server/services/coach-session-service.ts");
  const repository = read("src/server/repositories/supabase-coach-session-repository.ts");
  assert.match(service, /listOwnedSessions\(userId\)/);
  assert.match(service, /getOwnedSession\(userId, sessionId\)/);
  assert.match(
    service,
    /createSignedVideoUrl[\s\S]*getOwnedSession\(userId, sessionId\)[\s\S]*if \(!session\)[\s\S]*getOwnedVideoStorage\(userId, sessionId\)/,
  );
  assert.match(repository, /\.from\("practice_takes"\)[\s\S]*\.eq\("user_id", userId\)[\s\S]*\.eq\("session_id", sessionId\)/);
  assert.match(service, /storageObject\.storageBucket !== config\.video\.bucket/);
});

test("finalize delegates all JSON shape validation to the canonical service", () => {
  const route = read("src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts");
  const service = read("src/server/services/acting-coach-service.ts");
  assert.match(route, /finalizeUploadIntent\(uploadIntentId, payload, auth\.userId\)/);
  assert.doesNotMatch(route, /payload\.durationMs/);
  assert.doesNotMatch(route, /typeof payload|Array\.isArray\(payload\)/);
  assert.match(service, /finalizeUploadIntent\([\s\S]*exactBody\(payload, \["storagePath", "durationMs"\]\)/);
});
