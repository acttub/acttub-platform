import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.G012_RUN_DB_INTEGRATION === "1";
const psql = (db, sql) => execFileSync("psql", [db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
const exactExists = async (client, path) => { const parts = path.split("/"); const name = parts.pop(); const result = await client.storage.from("practice-videos").list(parts.join("/"), { search: name, limit: 2 }); assert.ifError(result.error); return result.data.some((entry) => entry.name === name); };

test("real private bucket sweeper removes abandoned objects, preserves referenced media, and is idempotent", { skip: !enabled, timeout: 120000 }, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = "25000000-0000-0000-0000-000000000001";
  const expiredSession = "25000000-0000-0000-0010-000000000001", linkedSession = "25000000-0000-0000-0010-000000000002", mismatchSession = "25000000-0000-0000-0010-000000000003", finalizedSession = "25000000-0000-0000-0010-000000000004";
  const expiredUpload = "25000000-0000-0000-0020-000000000001", linkedUpload = "25000000-0000-0000-0020-000000000002", mismatchUpload = "25000000-0000-0000-0020-000000000003", finalizedUpload = "25000000-0000-0000-0020-000000000004";
  const expiredPath = `users/${userId}/practice-sessions/${expiredSession}/take.mp4`, linkedPath = `users/${userId}/practice-sessions/${linkedSession}/take.mp4`, mismatchPath = `users/${userId}/practice-sessions/${mismatchSession}/take.mov`, finalizedPath = `users/${userId}/practice-sessions/${finalizedSession}/take.mp4`;
  psql(local.DB_URL, `
    insert into auth.users(id,aud,role,email,created_at,updated_at) values('${userId}','authenticated','authenticated','g012-entry@example.com',now(),now());
    insert into public.profiles(id,email,status) values('${userId}','g012-entry@example.com','pending_terms');
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at) values
      ('${expiredUpload}','${userId}','${expiredSession}','created','${expiredPath}','video/mp4',4,now()-interval '1 hour'),
      ('${linkedUpload}','${userId}','${linkedSession}','finalized','${linkedPath}','video/mp4',4,now()-interval '2 hour'),
      ('${mismatchUpload}','${userId}','${mismatchSession}','created','${mismatchPath}','video/quicktime',4,now()+interval '1 hour'),
      ('${finalizedUpload}','${userId}','${finalizedSession}','finalized','${finalizedPath}','video/mp4',4,now()-interval '2 hour');
    update public.upload_intents set actual_size_bytes=4 where id='${linkedUpload}';
    insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext)
      values('${linkedSession}','${userId}','${linkedUpload}','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
    insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,analysis_status)
      values('25000000-0000-0000-0030-000000000001','${linkedSession}','${userId}','${linkedPath}','video/mp4',4,'pending');
  `);
  for (const path of [expiredPath, linkedPath, mismatchPath, finalizedPath]) assert.ifError((await client.storage.from("practice-videos").upload(path, new Blob([new Uint8Array([1,2,3,4])], { type: "video/mp4" }))).error);
  try {
    const mismatch = await client.rpc("acttub_observe_upload_object", { p_upload_intent_id: mismatchUpload, p_user_id: userId, p_actual_size_bytes: 4, p_actual_mime_type: "video/mp4" }); assert.ifError(mismatch.error); assert.equal(mismatch.data, "source_video_metadata_invalid");
    assert.equal(psql(local.DB_URL, `select (actual_size_bytes=4)::text||':'||(expected_mime_type='video/quicktime')::text||':'||(cleanup_completed_at is null)::text from public.upload_intents where id='${mismatchUpload}'`), "true:true:true");
    const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, UPLOAD_CLEANUP_WORKER_BATCH_SIZE: "10", UPLOAD_CLEANUP_WORKER_LEASE_MS: "120000" };
    const first = spawnSync("pnpm", ["worker:upload-cleanup:once"], { cwd: new URL("../../..", import.meta.url).pathname, env, encoding: "utf8" }); assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(await exactExists(client, expiredPath), false, "expired created object is removed after TTL plus grace");
    assert.equal(await exactExists(client, mismatchPath), false, "durably fenced mismatch is removed");
    assert.equal(await exactExists(client, finalizedPath), false, "unconsumed finalized object is removed after grace");
    assert.equal(await exactExists(client, linkedPath), true, "session/take-linked object is preserved");
    assert.equal(psql(local.DB_URL, `select count(*) from public.upload_intents where id in ('${expiredUpload}','${mismatchUpload}','${finalizedUpload}') and cleanup_completed_at is not null`), "3");
    const second = spawnSync("pnpm", ["worker:upload-cleanup:once"], { cwd: new URL("../../..", import.meta.url).pathname, env, encoding: "utf8" }); assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(await exactExists(client, linkedPath), true, "second run remains a no-op for referenced media");
  } finally {
    await client.storage.from("practice-videos").remove([expiredPath, linkedPath, mismatchPath, finalizedPath]);
    psql(local.DB_URL, `delete from auth.users where id='${userId}'`);
  }
});
