#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { runUploadCleanupWorker } from "./lib/upload-cleanup-runner.mjs";

const required = (name) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; };
const integer = (name, fallback, min, max) => { const value = Number(process.env[name] ?? fallback); if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is invalid`); return value; };

export function readUploadCleanupConfig() {
  const config = {
    concurrency: integer("UPLOAD_CLEANUP_WORKER_CONCURRENCY", 1, 1, 4),
    leaseMs: integer("UPLOAD_CLEANUP_WORKER_LEASE_MS", 120000, 30000, 1800000),
    pollMs: integer("UPLOAD_CLEANUP_WORKER_POLL_MS", 5000, 50, 60000),
    batchSize: integer("UPLOAD_CLEANUP_WORKER_BATCH_SIZE", 10, 1, 50),
    purgeBatchSize: integer("UPLOAD_CLEANUP_WORKER_PURGE_BATCH_SIZE", 100, 1, 500),
    shutdownGraceMs: integer("UPLOAD_CLEANUP_WORKER_SHUTDOWN_GRACE_MS", 30000, 1000, 300000),
  };
  if (config.batchSize < config.concurrency) throw new Error("UPLOAD_CLEANUP_WORKER_BATCH_SIZE must cover concurrency");
  return config;
}

function repository(client) {
  const rpc = async (name, input) => { const { data, error } = await client.rpc(name, input); if (error) throw new Error(`${name}: ${error.message}`); return data; };
  return {
    purge: (batch) => rpc("acttub_purge_upload_cleanup_tombstones", { p_batch_size: batch }),
    claim: (token, seconds, batch) => rpc("acttub_claim_upload_cleanup_jobs", { p_lease_token: token, p_lease_seconds: seconds, p_batch_size: batch, p_worker_id: process.env.HOSTNAME ?? null }),
    recordObserved: (id, token, bytes) => rpc("acttub_record_upload_cleanup_observation", { p_job_id: id, p_lease_token: token, p_actual_size_bytes: bytes }),
    complete: (id, token, existed, bytes) => rpc("acttub_complete_upload_cleanup", { p_job_id: id, p_lease_token: token, p_object_existed: existed, p_cleaned_size_bytes: bytes }),
    fail: (id, token, code) => rpc("acttub_fail_upload_cleanup", { p_job_id: id, p_lease_token: token, p_safe_error_code: code }),
  };
}

async function main() {
  const config = readUploadCleanupConfig();
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const shutdown = { stopping: false };
  process.once("SIGTERM", () => { shutdown.stopping = true; }); process.once("SIGINT", () => { shutdown.stopping = true; });
  await runUploadCleanupWorker({ repository: repository(client), storage: client.storage, config, shutdown, once: process.argv.includes("--once") });
}

main().catch((error) => { console.error("upload cleanup worker failed", { message: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; });
