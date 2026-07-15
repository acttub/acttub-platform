import { randomUUID } from "node:crypto";
import { createMultipartStream } from "./multipart.mjs";

const canonicalObservationFields = ["timeline", "dialogue", "tempo", "pitch", "movement", "expression", "emotion"];
const anomalyFields = ["start", "end", "dimension", "what", "why_odd", "likely_cause", "impact_on_intent", "severity_reason"];

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const allStrings = (value, fields) => isRecord(value) && fields.every((field) => typeof value[field] === "string");
const hasErrorCode = (error, code) => error instanceof Error && error.message.includes(code);

export function requireSceneSummary(value) {
  if (!isRecord(value) || !allStrings(value.observation, canonicalObservationFields) ||
      !Array.isArray(value.observation.extra) || !value.observation.extra.every((entry) =>
        isRecord(entry) && typeof entry.name === "string" && typeof entry.observation === "string") ||
      !["summary", "intent_alignment", "key_moment", "key_dimension"].every((field) => typeof value[field] === "string") ||
      !Array.isArray(value.anomalies) || !value.anomalies.every((entry) =>
        allStrings(entry, anomalyFields) && typeof entry.overlaps_key_moment === "boolean" &&
        typeof entry.on_key_dimension === "boolean" && ["반전", "약화", "국소"].includes(entry.intent_impact) &&
        ["high", "mid", "low"].includes(entry.severity))) {
    throw Object.assign(new Error("acting-api returned an invalid response"), { code: "acting_api_invalid_response", retryable: true });
  }
  return value;
}

export function validateAnalysisSource(source, userId, sessionId) {
  const candidates = [
    { fileName: "take.mp4", mimeType: "video/mp4" },
    { fileName: "take.mov", mimeType: "video/quicktime" },
  ];
  const match = candidates.find(({ fileName, mimeType }) =>
    source.storagePath === `users/${userId}/practice-sessions/${sessionId}/${fileName}` && source.mimeType === mimeType);
  if (!match || typeof source.storageBucket !== "string") {
    throw Object.assign(new Error("invalid trusted source metadata"), { code: "source_video_metadata_invalid", definitive: true });
  }
  return match;
}

function classifyStatus(status) {
  if (status === 401) return { code: "acting_api_auth_failed", definitive: true };
  if (status === 413) return { code: "video_too_large", definitive: true };
  if (status === 422) return { code: "acting_api_contract_mismatch", definitive: true };
  if (status === 400 || status === 404) return { code: "acting_api_rejected", definitive: true };
  if (status === 429) return { code: "acting_api_rate_limited", definitive: true };
  return { code: "acting_api_unavailable", retryable: true };
}

async function prepareVideo(job, repository, fetchImpl, signal) {
  const metadata = validateAnalysisSource(job.analysis_source, job.user_id, job.session_id);
  let signedUrl;
  try { signedUrl = await repository.createSignedVideoUrl(job.analysis_source.storageBucket, job.analysis_source.storagePath); }
  catch { throw Object.assign(new Error("source video unavailable"), { code: "source_video_unavailable", definitive: true }); }
  let response;
  try { response = await fetchImpl(signedUrl, { signal }); }
  catch (error) {
    if (signal.aborted) {
      throw Object.assign(new Error("source video fetch aborted", { cause: error }), {
        code: "acting_api_timeout",
        retryable: true,
      });
    }
    throw Object.assign(new Error("source video unavailable"), { code: "source_video_unavailable", definitive: true });
  }
  if (!response.ok || !response.body) throw Object.assign(new Error("source video unavailable"), { code: "source_video_unavailable", definitive: true });
  return { metadata, stream: response.body };
}

async function summarize(job, video, config, fetchImpl, signal) {
  const multipart = createMultipartStream({
    fields: {
      situation: String(job.analysis_source.situation),
      character: String(job.analysis_source.characterContext),
      subtext: String(job.analysis_source.subtext),
    },
    video: video.stream,
    fileName: video.metadata.fileName,
    mimeType: video.metadata.mimeType,
  });
  let response;
  try {
    response = await fetchImpl(`${config.actingApiBaseUrl}/summarize`, {
      method: "POST",
      headers: { "X-API-Key": config.actingApiKey, "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` },
      body: multipart.body, duplex: "half", signal,
    });
  } catch (error) {
    throw Object.assign(new Error(signal.aborted ? "acting-api request aborted" : "acting-api unavailable", { cause: error }), {
      code: signal.aborted ? "acting_api_timeout" : "acting_api_unavailable",
      retryable: true,
    });
  }
  if (!response.ok) throw Object.assign(new Error(`acting-api ${response.status}`), classifyStatus(response.status));
  let payload;
  try { payload = await response.json(); }
  catch { throw Object.assign(new Error("invalid acting-api JSON"), { code: "acting_api_invalid_response", retryable: true }); }
  return requireSceneSummary(payload);
}

export async function runAnalysisJobOnce({ repository, config, fetchImpl = fetch, timers = globalThis, shutdown = { stopping: false } }) {
  if (shutdown.stopping) return { claimed: false };
  const leaseToken = randomUUID();
  const job = await repository.claim(leaseToken, Math.ceil(config.leaseMs / 1000));
  if (!job) return { claimed: false };

  const controller = new AbortController();
  const controllers = shutdown.controllers ?? (shutdown.controllers = new Set());
  controllers.add(controller);
  const timeout = timers.setTimeout(() => controller.abort(new DOMException("upstream timeout", "TimeoutError")), config.upstreamTimeoutMs);
  const heartbeat = timers.setInterval(() => {
    void repository.heartbeat(job.operation_id, leaseToken, Math.ceil(config.leaseMs / 1000)).then((live) => {
      if (!live) controller.abort(new DOMException("lease lost", "AbortError"));
    }).catch((error) => {
      if (hasErrorCode(error, "stale_analysis_lease")) controller.abort(new DOMException("lease lost", "AbortError"));
    });
  }, config.heartbeatMs);

  try {
    const video = await prepareVideo(job, repository, fetchImpl, controller.signal);
    const summary = await summarize(job, video, config, fetchImpl, controller.signal);
    try {
      await repository.complete(job, leaseToken, randomUUID(), summary);
    } catch (error) {
      if (hasErrorCode(error, "stale_analysis_lease")) return { claimed: true, outcome: "lease_lost" };
      throw Object.assign(new Error("analysis completion persistence failed", { cause: error }), { persistenceFailure: true });
    }
    return { claimed: true, outcome: "completed" };
  } catch (error) {
    if (error?.persistenceFailure) throw error.cause ?? error;
    const code = typeof error?.code === "string" ? error.code : "acting_api_unavailable";
    if (error?.definitive) {
      await repository.fail(job, leaseToken, code);
      return { claimed: true, outcome: "failed", code };
    }
    try {
      const outcome = await repository.requeue(job.operation_id, leaseToken, code);
      return { claimed: true, outcome, code };
    } catch (requeueError) {
      if (hasErrorCode(requeueError, "stale_analysis_lease")) {
        return { claimed: true, outcome: shutdown.stopping ? "lease_recovery" : "lease_lost", code };
      }
      if (shutdown.stopping) return { claimed: true, outcome: "lease_recovery", code };
      throw requeueError;
    }
  } finally {
    timers.clearTimeout(timeout);
    timers.clearInterval(heartbeat);
    controllers.delete(controller);
  }
}

export async function runAnalysisWorker(dependencies) {
  const { config, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), shutdown } = dependencies;
  if (dependencies.once) return runAnalysisJobOnce(dependencies);
  while (!shutdown.stopping) {
    const result = await runAnalysisJobOnce(dependencies);
    if (!result.claimed && !shutdown.stopping) await sleep(config.pollMs);
  }
  return { stopped: true };
}
