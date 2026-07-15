import assert from "node:assert/strict";
import test from "node:test";
import { deleteUploadObject } from "../src/server/storage/idempotent-storage-delete.mjs";
import { runUploadCleanupOnce } from "../workers/lib/upload-cleanup-runner.mjs";

function storageObject({ exists = true, size = 37, removeError = null, survivesRemove = false } = {}) {
  const removed = new Set(); const calls = [];
  return {
    calls,
    from(bucket) { return {
      async list(directory, options) { const full = `${directory}/${options.search}`; calls.push(["list", bucket, directory, options.search]); return { data: exists && !removed.has(full) ? [{ name: options.search, metadata: { size } }] : [], error: null }; },
      async remove(paths) { calls.push(["remove", bucket, paths]); if (!removeError && !survivesRemove) for (const path of paths) removed.add(path); return { data: null, error: removeError }; },
    }; },
  };
}

const job = (id = "j") => ({ id, upload_intent_id: `i-${id}`, lease_token: `l-${id}`, reason: "expired_unfinalized", attempt_count: 2, storage_bucket: "practice-videos", storage_path: `users/u/practice-sessions/${id}/take.mp4`, observed_size_bytes: null });

for (const invalid of [
  { bucket: "other", path: "users/u/practice-sessions/s/take.mp4" },
  { bucket: "practice-videos", path: "users/u/practice-sessions/s/other.mp4" },
]) test("delete rejects non-canonical single-object targets", async () => assert.rejects(() => deleteUploadObject({ storage: storageObject(), ...invalid }), { code: "invalid_cleanup_object" }));

test("exact inspect, live observation, single remove, and absence verification", async () => {
  const storage = storageObject({ size: 41 }); const observed = [];
  const result = await deleteUploadObject({ storage, bucket: "practice-videos", path: "users/u/practice-sessions/s/take.mp4", recordObserved: async (bytes) => observed.push(bytes) });
  assert.deepEqual(result, { objectExisted: true, observedSizeBytes: 41, cleanedSizeBytes: 41 });
  assert.deepEqual(observed, [41]);
  assert.deepEqual(storage.calls.map(([kind]) => kind), ["list", "remove", "list"]);
  assert.deepEqual(storage.calls[1][2], ["users/u/practice-sessions/s/take.mp4"]);
});

test("already absent is success and remove errors/post-delete presence fail", async () => {
  assert.deepEqual(await deleteUploadObject({ storage: storageObject({ exists: false }), bucket: "practice-videos", path: "users/u/practice-sessions/s/take.mov" }), { objectExisted: false, observedSizeBytes: null, cleanedSizeBytes: null });
  await assert.rejects(() => deleteUploadObject({ storage: storageObject({ removeError: new Error("private") }), bucket: "practice-videos", path: "users/u/practice-sessions/s/take.mov" }), { code: "storage_delete_failed" });
  await assert.rejects(() => deleteUploadObject({ storage: storageObject({ survivesRemove: true }), bucket: "practice-videos", path: "users/u/practice-sessions/s/take.mov" }), { code: "storage_delete_failed" });
});

test("runner persists observed bytes, logs safe outcome, and completes with exact cleaned bytes", async () => {
  const completed = [], observations = [], logs = [];
  const repository = { purge: async () => 0, claim: async () => job(), recordObserved: async (...args) => observations.push(args), complete: async (...args) => completed.push(args), fail: async () => assert.fail() };
  const result = await runUploadCleanupOnce({ repository, storage: storageObject({ size: 99 }), logger: (entry) => logs.push(entry) });
  assert.equal(result.outcome, "completed"); assert.equal(observations[0][2], 99); assert.equal(completed[0][3], 99);
  assert.equal(logs[0].event, "upload_cleanup_purge"); assert.equal(logs[1].event, "removed"); assert.equal(JSON.stringify(logs).includes("users/"), false);
});

test("runner invokes bounded tombstone purge even when no cleanup job is claimable", async () => {
  const calls = []; const logs = [];
  const repository = { purge: async (batch) => { calls.push(batch); return calls.length === 1 ? 2 : 0; }, claim: async () => [], recordObserved: async () => assert.fail(), complete: async () => assert.fail(), fail: async () => assert.fail() };
  assert.deepEqual(await runUploadCleanupOnce({ repository, storage: storageObject(), config: { purgeBatchSize: 25 }, logger: (entry) => logs.push(entry) }), { claimed: false, purgedCount: 2 });
  assert.deepEqual(await runUploadCleanupOnce({ repository, storage: storageObject(), config: { purgeBatchSize: 25 }, logger: (entry) => logs.push(entry) }), { claimed: false, purgedCount: 0 });
  assert.deepEqual(calls, [25, 25]);
  assert.deepEqual(logs, [{ event: "upload_cleanup_purge", purgedCount: 2 }, { event: "upload_cleanup_purge", purgedCount: 0 }]);
});

test("remove failure requeues and delete-success/DB-crash converges as already absent", async () => {
  const failed = []; const repository = { purge: async () => 0, claim: async () => job(), recordObserved: async () => {}, complete: async () => {}, fail: async (...args) => failed.push(args) };
  assert.equal((await runUploadCleanupOnce({ repository, storage: storageObject({ removeError: new Error("secret") }) })).outcome, "failed");
  assert.equal(failed[0][2], "storage_delete_failed");
  const durableStorage = storageObject(); let crash = true;
  repository.complete = async () => { if (crash) { crash = false; throw new Error("db crash"); } };
  await assert.rejects(() => runUploadCleanupOnce({ repository, storage: durableStorage }), /db crash/);
  assert.equal((await runUploadCleanupOnce({ repository, storage: durableStorage })).outcome, "completed");
});

test("stale lease is benign and batch concurrency processes every claim", async () => {
  const jobs = [job("a"), job("b"), job("c")]; let active = 0, maxActive = 0; const completed = [];
  const repository = { purge: async () => 0, claim: async () => jobs, recordObserved: async () => { active += 1; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 5)); active -= 1; }, complete: async (id) => completed.push(id), fail: async () => assert.fail() };
  const result = await runUploadCleanupOnce({ repository, storage: storageObject(), config: { concurrency: 2, batchSize: 3 } });
  assert.deepEqual(result, { claimed: true, purgedCount: 0, outcome: "completed", processed: 3 }); assert.equal(completed.length, 3); assert.equal(maxActive, 2);
  repository.claim = async () => job("stale"); repository.complete = async () => { throw new Error("stale_cleanup_lease"); };
  assert.equal((await runUploadCleanupOnce({ repository, storage: storageObject() })).outcome, "lease_lost");
});
