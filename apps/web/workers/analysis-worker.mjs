#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { runAnalysisWorker } from "./lib/analysis-job-runner.mjs";
import { assertFfprobeAvailable } from "./lib/trusted-media-probe.mjs";
import { deleteUploadObject } from "./lib/idempotent-storage-delete.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

export function readWorkerConfig() {
  const config = {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    actingApiBaseUrl: required("ACTING_API_BASE_URL").replace(/\/$/u, ""),
    actingApiKey: required("ACTING_API_KEY"),
    concurrency: integer("ANALYSIS_WORKER_CONCURRENCY", 1, { max: 4 }),
    leaseMs: integer("ANALYSIS_WORKER_LEASE_MS", 120000, { min: 30000, max: 1800000 }),
    heartbeatMs: integer("ANALYSIS_WORKER_HEARTBEAT_MS", 30000, { min: 1000, max: 899999 }),
    pollMs: integer("ANALYSIS_WORKER_POLL_MS", 1000, { min: 50, max: 60000 }),
    upstreamTimeoutMs: integer("ANALYSIS_WORKER_UPSTREAM_TIMEOUT_MS", 900000, { min: 1000, max: 1800000 }),
    shutdownGraceMs: integer("ANALYSIS_WORKER_SHUTDOWN_GRACE_MS", 30000, { min: 1000, max: 300000 }),
    ffprobePath: process.env.ANALYSIS_WORKER_FFPROBE_PATH?.trim() || "ffprobe",
    mediaTmpDir: process.env.ANALYSIS_WORKER_MEDIA_TMP_DIR?.trim() || os.tmpdir(),
    maxSourceBytes: 550 * 1024 * 1024,
  };
  if (config.heartbeatMs >= config.leaseMs / 2) throw new Error("ANALYSIS_WORKER_HEARTBEAT_MS must be less than half the lease");
  if (config.upstreamTimeoutMs <= config.heartbeatMs) throw new Error("ANALYSIS_WORKER_UPSTREAM_TIMEOUT_MS must exceed the heartbeat interval");
  return config;
}

function createRepository(client) {
  const rpc = async (name, input) => {
    const { data, error } = await client.rpc(name, input);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  };
  return {
    async claim(token, seconds) {
      const rows = await rpc("acttub_claim_next_analysis_job_v2", { p_lease_token: token, p_lease_seconds: seconds, p_worker_id: process.env.HOSTNAME ?? null });
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    heartbeat(operationId, token, seconds) {
      return rpc("acttub_extend_analysis_job_lease", { p_operation_id: operationId, p_lease_token: token, p_lease_seconds: seconds });
    },
    requeue(operationId, token, code) {
      return rpc("acttub_requeue_analysis_job", { p_operation_id: operationId, p_lease_token: token, p_safe_error_code: code });
    },
    complete(job, token, sceneSummaryId, summary) {
      return rpc("acttub_complete_analysis", { p_session_id: job.session_id, p_user_id: job.user_id, p_operation_id: job.operation_id, p_lease_token: token, p_scene_summary_id: sceneSummaryId, p_summary_payload: summary });
    },
    fail(job, token, code) {
      return rpc("acttub_fail_analysis", { p_session_id: job.session_id, p_user_id: job.user_id, p_operation_id: job.operation_id, p_lease_token: token, p_failure_class: "definitive", p_safe_error_code: code });
    },
    recordProbe(job, token, durationMs, mediaMetadataVersion, actualSizeBytes) {
      return rpc("acttub_record_trusted_media_probe_v2", {
        p_session_id: job.session_id,
        p_user_id: job.user_id,
        p_operation_id: job.operation_id,
        p_lease_token: token,
        p_authoritative_duration_ms: durationMs,
        p_media_metadata_version: mediaMetadataVersion,
        p_actual_size_bytes: actualSizeBytes,
      });
    },
    failMediaValidation(job, token, code) {
      return rpc("acttub_fail_trusted_media_validation", {
        p_session_id: job.session_id,
        p_user_id: job.user_id,
        p_operation_id: job.operation_id,
        p_lease_token: token,
        p_safe_error_code: code,
      });
    },
    async bestEffortCleanup(job) {
      const { data: session } = await client.from("practice_sessions").select("upload_intent_id").eq("id", job.session_id).eq("user_id", job.user_id).maybeSingle();
      if (!session?.upload_intent_id) return;
      const cleanupToken = randomUUID();
      const rows = await rpc("acttub_claim_upload_cleanup_job", { p_upload_intent_id: session.upload_intent_id, p_lease_token: cleanupToken, p_lease_seconds: 30, p_worker_id: "analysis-immediate" });
      const cleanup = Array.isArray(rows) ? rows[0] : rows;
      if (!cleanup) return;
      try {
        const result = await Promise.race([
          deleteUploadObject({ storage: client.storage, bucket: cleanup.storage_bucket, path: cleanup.storage_path,
            recordObserved: (bytes) => rpc("acttub_record_upload_cleanup_observation", { p_job_id: cleanup.id, p_lease_token: cleanupToken, p_actual_size_bytes: bytes }) }),
          new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("cleanup timeout"), { code: "timeout" })), 10000)),
        ]);
        await rpc("acttub_complete_upload_cleanup", { p_job_id: cleanup.id, p_lease_token: cleanupToken, p_object_existed: result.objectExisted, p_cleaned_size_bytes: result.cleanedSizeBytes });
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "storage_delete_failed";
        await rpc("acttub_fail_upload_cleanup", { p_job_id: cleanup.id, p_lease_token: cleanupToken, p_safe_error_code: code });
      }
    },
    async createSignedVideoUrl(bucket, path) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 900);
      if (error || !data?.signedUrl) throw Object.assign(new Error("source video unavailable"), { code: "source_video_unavailable", definitive: true });
      return data.signedUrl;
    },
  };
}

async function main() {
  const config = readWorkerConfig();
  await assertFfprobeAvailable(config.ffprobePath);
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const shutdown = { stopping: false, controllers: new Set() };
  let graceTimer;
  const stop = () => {
    if (shutdown.stopping) return;
    shutdown.stopping = true;
    graceTimer = setTimeout(() => {
      for (const controller of shutdown.controllers) controller.abort(new DOMException("worker shutdown", "AbortError"));
    }, config.shutdownGraceMs);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const once = process.argv.includes("--once");
  const repository = createRepository(client);
  if (once || config.concurrency === 1) {
    await runAnalysisWorker({ repository, config, shutdown, once });
  } else {
    await Promise.all(Array.from({ length: config.concurrency }, () => runAnalysisWorker({ repository, config, shutdown, once: false })));
  }
  if (graceTimer) clearTimeout(graceTimer);
}

main().catch((error) => {
  console.error("analysis worker failed", { message: error instanceof Error ? error.message : String(error), workerBootId: randomUUID() });
  process.exitCode = 1;
});
