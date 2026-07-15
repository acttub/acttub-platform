import { randomUUID } from "node:crypto";
import { deleteUploadObject } from "./idempotent-storage-delete.mjs";

const staleLease = (error) => error instanceof Error && error.message.includes("stale_cleanup_lease");

async function processJob({ job, leaseToken, repository, storage, logger }) {
  const event = { event: "upload_cleanup", reason: job.reason, attempt: job.attempt_count, observedBytes: job.observed_size_bytes ?? null };
  try {
    const deleted = await deleteUploadObject({
      storage, bucket: job.storage_bucket, path: job.storage_path,
      recordObserved: (sizeBytes) => repository.recordObserved(job.id, job.lease_token ?? leaseToken, sizeBytes),
    });
    try {
      const completed = await repository.complete(job.id, job.lease_token ?? leaseToken, deleted.objectExisted, deleted.cleanedSizeBytes);
      if (completed === false) { logger({ ...event, event: "lease_lost", cleanedBytes: null }); return { claimed: true, outcome: "lease_lost" }; }
    } catch (error) {
      if (staleLease(error)) { logger({ ...event, event: "lease_lost", cleanedBytes: null }); return { claimed: true, outcome: "lease_lost" }; }
      throw Object.assign(new Error("cleanup completion persistence failed", { cause: error }), { persistenceFailure: true });
    }
    logger({ ...event, event: deleted.objectExisted ? "removed" : "already_absent", cleanedBytes: deleted.cleanedSizeBytes });
    return { outcome: "completed" };
  } catch (error) {
    if (error?.persistenceFailure) throw error.cause ?? error;
    if (staleLease(error)) return { claimed: true, outcome: "lease_lost" };
    const safeCode = typeof error?.code === "string" ? error.code : "storage_delete_failed";
    try { await repository.fail(job.id, job.lease_token ?? leaseToken, safeCode); }
    catch (failure) { if (staleLease(failure)) return { claimed: true, outcome: "lease_lost" }; throw failure; }
    logger({ ...event, outcome: "failed", safeErrorCode: safeCode, cleanedBytes: null });
    return { outcome: "failed", code: safeCode };
  }
}

export async function runUploadCleanupOnce({ repository, storage, config = {}, logger = console.info }) {
  const purgedCount = await repository.purge(config.purgeBatchSize ?? 100);
  logger({ event: "upload_cleanup_purge", purgedCount });
  const leaseToken = randomUUID();
  const claimed = await repository.claim(leaseToken, Math.ceil((config.leaseMs ?? 120000) / 1000), config.batchSize ?? 10);
  const jobs = Array.isArray(claimed) ? claimed : claimed ? [claimed] : [];
  if (jobs.length === 0) return { claimed: false, purgedCount };
  const concurrency = Math.min(config.concurrency ?? 1, jobs.length);
  const results = new Array(jobs.length); let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < jobs.length) {
      const index = cursor; cursor += 1;
      results[index] = await processJob({ job: jobs[index], leaseToken, repository, storage, logger });
    }
  }));
  if (results.length === 1) return { claimed: true, purgedCount, ...results[0] };
  return { claimed: true, purgedCount, outcome: results.every((result) => result.outcome === "completed") ? "completed" : "partial", processed: results.length };
}

export async function runUploadCleanupWorker({ shutdown, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ...dependencies }) {
  if (dependencies.once) return runUploadCleanupOnce(dependencies);
  while (!shutdown.stopping) {
    const result = await runUploadCleanupOnce(dependencies);
    if (!result.claimed && !shutdown.stopping) await sleep(dependencies.config.pollMs);
  }
  return { stopped: true };
}
