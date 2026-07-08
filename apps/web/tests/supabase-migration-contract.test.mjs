import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("executable migration matches Slice 1 private practice video upload contract", () => {
  const sql = read("supabase/migrations/001_acttub_slice1_schema.sql");
  assert.match(sql, /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
  assert.match(sql, /values \(\s*'practice-videos',\s*'practice-videos',\s*false,\s*314572800,\s*array\['video\/mp4', 'video\/quicktime'\]\s*\)/);
  assert.match(sql, /create policy "practice videos insert via active upload intent"/);
  assert.match(sql, /ui\.status = 'created'/);
  assert.match(sql, /ui\.expected_storage_path = storage\.objects\.name/);
  assert.doesNotMatch(sql, /for select\s+to authenticated[\s\S]{0,120}storage\.objects/i);
  assert.doesNotMatch(sql, /for update\s+to authenticated[\s\S]{0,120}storage\.objects/i);
  assert.doesNotMatch(sql, /for delete\s+to authenticated[\s\S]{0,120}storage\.objects/i);
});

test("app and executable migration share upload bucket and path convention", () => {
  const sql = read("supabase/migrations/001_acttub_slice1_schema.sql");
  const service = read("apps/web/src/server/services/coach-session-service.ts");
  const env = read("apps/web/src/lib/config/env.ts");

  assert.match(service, /storageBucket: config\.video\.bucket as PracticeUploadIntentDto\["storageBucket"\]/);
  assert.match(env, /"practice-videos"/);
  assert.match(service, /users\/\$\{userId\}\/practice-sessions\/\$\{sessionId\}\/take\.\$\{extension\}/);
  assert.match(sql, /'users\/' \|\| user_id::text \|\| '\/practice-sessions\/' \|\| session_id::text \|\| '\/take\.'/);
});
