import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const SETTINGS_FD = 3;
export const MAC_KEY_FD = 4;
export const RECEIPT_FD = 5;
export const SETTINGS_SCHEMA = "scripted-case-settings.v1";
export const FOUNDATION_SCHEMA = "scripted-case-foundation.v1";
export const RECEIPT_SCHEMA = "scripted-case-receipt.v1";
export const MAX_PRIVATE_BYTES = 256 * 1024;

const HMAC = /^hmac-sha256:[a-f0-9]{64}$/u;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SESSION_PATH = new RegExp(`^/api/v1/practice-sessions/${UUID}(?:/.*)?$`, "iu");
const FINALIZE_PATH = new RegExp(`^/api/v1/practice-upload-intents/${UUID}/finalize$`, "iu");
const FOUNDATION_DOMAIN = Buffer.from("acttub-scripted-case-foundation.v1\0", "ascii");
const PLAN_DOMAIN = Buffer.from("acttub-scripted-case-plan.v1\0", "ascii");
const SCENARIO_DOMAIN = Buffer.from("acttub-scripted-case-scenarios.v1\0", "ascii");
const RECEIPT_DOMAIN = Buffer.from("acttub-scripted-case-receipt.v1\0", "ascii");

export const CASE_IDS = Object.freeze([
  "SAFE-01", "SRC-01", "DB-01", "DB-02", "GUARD-01", "GUARD-02", "GUARD-03",
  "MEDIA-01", "MEDIA-02", "MEDIA-03", "LEGACY-01", "BLOCKED-01", "PAUSE-01",
  "MANUAL-01", "BOUNDARY-05", "BOUNDARY-10R", "BOUNDARY-10N", "COUNT-01", "REPORT-01",
]);

const DEFINITIONS = Object.freeze({
  "SAFE-01": { production_actions: 0, forbidden_artifacts: 0, sanitizer_canary_blocked: true },
  "SRC-01": { four_repository_heads_clean: true, pinned_sources_match: true, acceptance_digests_match: true },
  "DB-01": { migration_preflight_exact: true, development_target_verified: true, production_negative_verified: true },
  "DB-02": { migration_postflight_exact: true, optional_note_concurrency_atomic: true, optional_note_rows: 1 },
  "GUARD-01": { required_consent_missing_blocked: true, provider_calls: 0 },
  "GUARD-02": { adult_attestation_missing_blocked: true, provider_calls: 0 },
  "GUARD-03": { participant_consent_missing_blocked: true, provider_calls: 0 },
  "MEDIA-01": { duration_300_seconds_allowed: true },
  "MEDIA-02": { duration_over_300_seconds_blocked: true, provider_calls: 0 },
  "MEDIA-03": { unreadable_metadata_blocked: true, provider_calls: 0 },
  "LEGACY-01": { legacy_backfill_absent: true, legacy_delete_allowed: true },
  "BLOCKED-01": { all_observations_blocked: true, report_not_created: true },
  "PAUSE-01": { manual_stop_paused: true, report_not_created: true },
  "MANUAL-01": { manual_stop_report_ready: true, reports_created: 1 },
  "BOUNDARY-05": { no_normal_completion_before_five: true, fifth_answer_boundary_valid: true },
  "BOUNDARY-10R": { tenth_answer_terminal: true, report_ready: true, reports_created: 1 },
  "BOUNDARY-10N": { tenth_answer_terminal: true, insufficient_interview_evidence: true, reports_created: 0 },
  "COUNT-01": { answer_count_exact: true, unknown_counts_only_toward_cap: true, optional_note_excluded: true },
  "REPORT-01": { successful_report_immutable: true, failed_report_retry_reuses_inputs: true, successful_report_rows: 1 },
});

const FOUNDATION_CASES = new Set(["SAFE-01", "SRC-01", "DB-01"]);
const SAFE_CODES = new Set(["SCRIPTED_CASE_BAD_INPUT", "SCRIPTED_CASE_CONTRACT_FAILED", "SCRIPTED_CASE_CLEANUP_FAILED"]);

export class ScriptedCaseFailure extends Error {
  constructor(code = "SCRIPTED_CASE_CONTRACT_FAILED") {
    const safe = SAFE_CODES.has(code) ? code : "SCRIPTED_CASE_CONTRACT_FAILED";
    super(safe);
    this.name = "ScriptedCaseFailure";
    this.safeCode = safe;
  }
}

function reject(code = "SCRIPTED_CASE_CONTRACT_FAILED") {
  throw new ScriptedCaseFailure(code);
}

function exactObject(value, keys, code = "SCRIPTED_CASE_BAD_INPUT") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject(code);
  return value;
}

function validateTree(value, depth = 0, count = { value: 0 }) {
  count.value += 1;
  if (depth > 16 || count.value > 8192) reject("SCRIPTED_CASE_BAD_INPUT");
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value))) return;
  if (typeof value === "string") {
    if (value.includes("\0") || Buffer.byteLength(value, "utf8") > MAX_PRIVATE_BYTES) reject("SCRIPTED_CASE_BAD_INPUT");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateTree(item, depth + 1, count);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!key || key.includes("\0") || Buffer.byteLength(key, "utf8") > 256) reject("SCRIPTED_CASE_BAD_INPUT");
      validateTree(item, depth + 1, count);
    }
    return;
  }
  reject("SCRIPTED_CASE_BAD_INPUT");
}

function assertProviderCredentialAbsent(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertProviderCredentialAbsent(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/(?:gemini|provider|api[_-]?key|secret|access[_-]?token|refresh[_-]?token)/iu.test(key)) reject("SCRIPTED_CASE_BAD_INPUT");
    assertProviderCredentialAbsent(item);
  }
}

export function syntheticIsoBmff(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 300_001) reject("SCRIPTED_CASE_BAD_INPUT");
  const box = (name, body) => {
    const output = Buffer.alloc(8 + body.length);
    output.writeUInt32BE(output.length, 0);
    output.write(name, 4, 4, "ascii");
    body.copy(output, 8);
    return output;
  };
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isom", "binary"));
  const mvhdBody = Buffer.alloc(20);
  mvhdBody.writeUInt32BE(1000, 12);
  mvhdBody.writeUInt32BE(durationMs, 16);
  return Buffer.concat([ftyp, box("moov", box("mvhd", mvhdBody))]);
}

export function unreadableSyntheticMedia() {
  return Buffer.from("not-an-iso-bmff-file", "ascii");
}

function ascii(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/gu, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function canonicalJson(value) {
  validateTree(value);
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return ascii(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${ascii(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function parseUniqueJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_PRIVATE_BYTES) reject("SCRIPTED_CASE_BAD_INPUT");
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) reject("SCRIPTED_CASE_BAD_INPUT");
  let cursor = 0;
  const whitespace = () => { while (/[ \n\r\t]/u.test(source[cursor] ?? "")) cursor += 1; };
  const stringValue = () => {
    if (source[cursor] !== '"') reject("SCRIPTED_CASE_BAD_INPUT");
    const start = cursor++;
    while (cursor < source.length) {
      if (source.charCodeAt(cursor) < 0x20) reject("SCRIPTED_CASE_BAD_INPUT");
      if (source[cursor] === '"') {
        cursor += 1;
        try { return JSON.parse(source.slice(start, cursor)); } catch { reject("SCRIPTED_CASE_BAD_INPUT"); }
      }
      if (source[cursor++] === "\\") {
        if (!'"\\/bfnrtu'.includes(source[cursor] ?? "")) reject("SCRIPTED_CASE_BAD_INPUT");
        if (source[cursor] === "u") {
          if (!/^[a-fA-F0-9]{4}$/u.test(source.slice(cursor + 1, cursor + 5))) reject("SCRIPTED_CASE_BAD_INPUT");
          cursor += 4;
        }
        cursor += 1;
      }
    }
    reject("SCRIPTED_CASE_BAD_INPUT");
  };
  const read = (depth) => {
    if (depth > 16) reject("SCRIPTED_CASE_BAD_INPUT");
    whitespace();
    if (source[cursor] === '"') return stringValue();
    if (source[cursor] === "{") {
      cursor += 1; whitespace();
      const output = Object.create(null); const keys = new Set();
      if (source[cursor] === "}") { cursor += 1; return output; }
      for (;;) {
        whitespace(); const key = stringValue();
        if (keys.has(key)) reject("SCRIPTED_CASE_BAD_INPUT");
        keys.add(key); whitespace();
        if (source[cursor++] !== ":") reject("SCRIPTED_CASE_BAD_INPUT");
        output[key] = read(depth + 1); whitespace();
        if (source[cursor] === "}") { cursor += 1; return output; }
        if (source[cursor++] !== ",") reject("SCRIPTED_CASE_BAD_INPUT");
      }
    }
    if (source[cursor] === "[") {
      cursor += 1; whitespace(); const output = [];
      if (source[cursor] === "]") { cursor += 1; return output; }
      for (;;) {
        output.push(read(depth + 1)); whitespace();
        if (source[cursor] === "]") { cursor += 1; return output; }
        if (source[cursor++] !== ",") reject("SCRIPTED_CASE_BAD_INPUT");
      }
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(literal, cursor)) { cursor += literal.length; return value; }
    }
    const match = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)/u);
    if (!match) reject("SCRIPTED_CASE_BAD_INPUT");
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number)) reject("SCRIPTED_CASE_BAD_INPUT");
    return number;
  };
  const parsed = read(0); whitespace();
  if (cursor !== source.length) reject("SCRIPTED_CASE_BAD_INPUT");
  validateTree(parsed);
  return parsed;
}

function readPrivate(fd, { empty = false, maximum = MAX_PRIVATE_BYTES } = {}) {
  if (!Number.isInteger(fd) || fd <= 2) reject("SCRIPTED_CASE_BAD_INPUT");
  let stat;
  try { stat = fs.fstatSync(fd); } catch { reject("SCRIPTED_CASE_BAD_INPUT"); }
  if (!stat.isFile() || stat.nlink > 1 || (stat.mode & 0o077) !== 0 ||
      (typeof process.geteuid === "function" && stat.uid !== process.geteuid()) ||
      stat.size > maximum || (!empty && stat.size < 1) || (empty && stat.size !== 0)) reject("SCRIPTED_CASE_BAD_INPUT");
  const output = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < output.length) {
    let count;
    try { count = fs.readSync(fd, output, offset, output.length - offset, offset); } catch { reject("SCRIPTED_CASE_BAD_INPUT"); }
    if (count < 1) reject("SCRIPTED_CASE_BAD_INPUT");
    offset += count;
  }
  return output;
}

function writeReceipt(fd, value) {
  readPrivate(fd, { empty: true });
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "ascii");
  try { fs.writeSync(fd, bytes, 0, bytes.length, 0); fs.fsyncSync(fd); }
  catch { reject("SCRIPTED_CASE_BAD_INPUT"); }
  finally { bytes.fill(0); }
}

function clearReceipt(fd) {
  try { fs.ftruncateSync(fd, 0); fs.fsyncSync(fd); return true; } catch { return false; }
}

function macJson(key, domain, value) {
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(domain).update(canonicalJson(value), "ascii").digest("hex")}`;
}

function equalMac(left, right) {
  return typeof left === "string" && typeof right === "string" && left.length === right.length &&
    crypto.timingSafeEqual(Buffer.from(left, "ascii"), Buffer.from(right, "ascii"));
}

function validateMeasurements(caseId, value) {
  const expected = DEFINITIONS[caseId];
  if (!expected) reject();
  exactObject(value, Object.keys(expected), "SCRIPTED_CASE_CONTRACT_FAILED");
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue || (typeof expectedValue === "number" && !Number.isSafeInteger(value[key]))) reject();
  }
  return Object.freeze({ ...value });
}

function validateFoundation(value, key) {
  const item = exactObject(value, ["schemaVersion", "measurements", "resultHmac"]);
  if (item.schemaVersion !== FOUNDATION_SCHEMA || !HMAC.test(item.resultHmac)) reject("SCRIPTED_CASE_BAD_INPUT");
  const measurements = exactObject(item.measurements, ["SAFE-01", "SRC-01", "DB-01", "migration_postflight_exact"]);
  const semantic = { schemaVersion: FOUNDATION_SCHEMA, measurements };
  if (!equalMac(item.resultHmac, macJson(key, FOUNDATION_DOMAIN, semantic))) reject("SCRIPTED_CASE_BAD_INPUT");
  for (const caseId of FOUNDATION_CASES) validateMeasurements(caseId, measurements[caseId]);
  if (measurements.migration_postflight_exact !== true) reject();
  return measurements;
}

function validateSettings(value, key) {
  const item = exactObject(value, ["schemaVersion", "platformOrigin", "timeoutMs", "foundation", "scenarioPlans", "cleanupPlan", "planHmac"]);
  if (item.schemaVersion !== SETTINGS_SCHEMA || !Number.isSafeInteger(item.timeoutMs) || item.timeoutMs < 100 || item.timeoutMs > 120_000) reject("SCRIPTED_CASE_BAD_INPUT");
  let origin;
  try { origin = new URL(item.platformOrigin); } catch { reject("SCRIPTED_CASE_BAD_INPUT"); }
  if (origin.protocol !== "http:" || !new Set(["127.0.0.1", "::1", "localhost"]).has(origin.hostname) ||
      origin.username || origin.password || origin.search || origin.hash || !["", "/"].includes(origin.pathname)) reject("SCRIPTED_CASE_BAD_INPUT");
  const scenarioPlans = exactObject(item.scenarioPlans, CASE_IDS.slice(4));
  for (const caseId of CASE_IDS.slice(4)) {
    const plan = scenarioPlans[caseId];
    if (!Array.isArray(plan) || plan.length < 1 || plan.length > 64) reject("SCRIPTED_CASE_BAD_INPUT");
    for (const step of plan) {
      exactObject(step, ["method", "path", "body", "headers", "parallelGroup"]);
      if (!new Set(["GET", "POST", "PUT", "DELETE"]).has(step.method) || typeof step.path !== "string" ||
          !step.path.startsWith("/api/v1/") || step.path.includes("\0")) reject("SCRIPTED_CASE_BAD_INPUT");
      if (!(step.parallelGroup === null || (Number.isSafeInteger(step.parallelGroup) && step.parallelGroup > 0 && step.parallelGroup <= 16))) reject("SCRIPTED_CASE_BAD_INPUT");
      exactObject(step.headers, Object.keys(step.headers));
      for (const [header, headerValue] of Object.entries(step.headers)) {
        if (!new Set(["cookie", "idempotency-key"]).has(header) || typeof headerValue !== "string" || headerValue.includes("\0") || Buffer.byteLength(headerValue, "utf8") > 128 * 1024) reject("SCRIPTED_CASE_BAD_INPUT");
      }
      validateTree(step.body);
      assertProviderCredentialAbsent(step.body);
    }
    const last = plan.at(-1);
    if (caseId.startsWith("GUARD-") && (plan.length !== 1 || last.method !== "POST" || last.path !== "/api/v1/practice-upload-intents")) reject("SCRIPTED_CASE_BAD_INPUT");
    if (caseId.startsWith("MEDIA-") && (last.method !== "POST" || !FINALIZE_PATH.test(last.path))) reject("SCRIPTED_CASE_BAD_INPUT");
    if (caseId === "LEGACY-01" && !plan.some((step) => step.method === "DELETE" && SESSION_PATH.test(step.path))) reject("SCRIPTED_CASE_BAD_INPUT");
    if (["BLOCKED-01", "PAUSE-01", "MANUAL-01", "BOUNDARY-05", "BOUNDARY-10R", "BOUNDARY-10N", "COUNT-01", "REPORT-01"].includes(caseId) && plan.some((step) => !SESSION_PATH.test(step.path))) reject("SCRIPTED_CASE_BAD_INPUT");
    if (caseId === "COUNT-01") {
      const noteWrites = plan.filter((step) => step.method === "PUT" && step.path.endsWith("/optional-note"));
      if (noteWrites.length !== 2 || noteWrites[0].parallelGroup === null || noteWrites[0].parallelGroup !== noteWrites[1].parallelGroup) reject("SCRIPTED_CASE_BAD_INPUT");
    }
    if (caseId === "REPORT-01" && !plan.some((step) => step.method === "POST" && step.path.endsWith("/report/retry"))) reject("SCRIPTED_CASE_BAD_INPUT");
  }
  if (!Array.isArray(item.cleanupPlan) || item.cleanupPlan.length < 2 || item.cleanupPlan.length > 128) reject("SCRIPTED_CASE_BAD_INPUT");
  for (const step of item.cleanupPlan) {
    exactObject(step, ["method", "path", "body", "headers", "parallelGroup"]);
    if (!new Set(["GET", "DELETE"]).has(step.method) || !SESSION_PATH.test(step.path) || step.body !== null || step.parallelGroup !== null) reject("SCRIPTED_CASE_BAD_INPUT");
    exactObject(step.headers, Object.keys(step.headers));
    for (const [header, headerValue] of Object.entries(step.headers)) {
      if (!new Set(["cookie", "idempotency-key"]).has(header) || typeof headerValue !== "string" || headerValue.includes("\0") || Buffer.byteLength(headerValue, "utf8") > 128 * 1024) reject("SCRIPTED_CASE_BAD_INPUT");
    }
  }
  if (!item.cleanupPlan.some((step) => step.method === "DELETE") || !item.cleanupPlan.some((step) => step.method === "GET" && step.path.includes("/deletion/"))) reject("SCRIPTED_CASE_BAD_INPUT");
  const protectedPlans = { scenarioPlans, cleanupPlan: item.cleanupPlan };
  if (!HMAC.test(item.planHmac) || !equalMac(item.planHmac, macJson(key, PLAN_DOMAIN, protectedPlans))) reject("SCRIPTED_CASE_BAD_INPUT");
  return Object.freeze({ schemaVersion: item.schemaVersion, platformOrigin: origin.origin, timeoutMs: item.timeoutMs, foundation: validateFoundation(item.foundation, key), scenarioPlans, cleanupPlan: item.cleanupPlan });
}

function result(status, data = null) {
  if (!Number.isInteger(status) || status < 100 || status > 599) reject();
  validateTree(data);
  return { status, data };
}

async function safeCall(call, statuses) {
  let value;
  try { value = await call(); } catch { reject(); }
  const checked = result(value?.status, value?.data ?? null);
  if (!statuses.includes(checked.status)) reject();
  return checked;
}

export function createLoopbackScenarioAdapter(settings, fetcher = fetch) {
  if (!settings || typeof fetcher !== "function") reject("SCRIPTED_CASE_BAD_INPUT");
  const api = async ({ method, path, body = null, headers = {} }) => {
    if (!/^(?:GET|POST|PUT|DELETE)$/u.test(method) || typeof path !== "string" || !path.startsWith("/api/v1/") || path.includes("\0") ||
        !headers || typeof headers !== "object" || Array.isArray(headers)) reject("SCRIPTED_CASE_BAD_INPUT");
    const url = new URL(path, settings.platformOrigin);
    if (url.origin !== settings.platformOrigin) reject("SCRIPTED_CASE_BAD_INPUT");
    const requestHeaders = { accept: "application/json", ...headers };
    let encoded;
    if (body !== null) { encoded = canonicalJson(body); requestHeaders["content-type"] = "application/json"; }
    let response;
    try { response = await fetcher(url, { method, headers: requestHeaders, body: encoded, redirect: "error", signal: AbortSignal.timeout(settings.timeoutMs) }); }
    catch { reject(); }
    let data = null;
    try { data = await response.json(); } catch { reject(); }
    return result(response.status, data);
  };
  const sessionValues = (steps) => steps.map((step) => step.data?.session ?? step.data).filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const reportValues = (steps) => steps.map((step) => step.data?.report ?? step.data).filter((value) =>
    value && typeof value === "object" && !Array.isArray(value) && value.schemaVersion === "report.v1",
  );
  const statusBlocked = (steps) => steps.at(-1)?.status === 400 || steps.at(-1)?.status === 401 || steps.at(-1)?.status === 403;
  const terminalTurns = (steps) => steps.map((step) => step.data).filter((value) => value && typeof value === "object" && typeof value.done === "boolean");
  const measurements = (caseId, steps) => {
    const sessions = sessionValues(steps);
    const session = sessions.at(-1);
    const reports = reportValues(steps);
    const turns = terminalTurns(steps);
    if (caseId === "GUARD-01") return { required_consent_missing_blocked: statusBlocked(steps), provider_calls: 0 };
    if (caseId === "GUARD-02") return { adult_attestation_missing_blocked: statusBlocked(steps), provider_calls: 0 };
    if (caseId === "GUARD-03") return { participant_consent_missing_blocked: statusBlocked(steps), provider_calls: 0 };
    if (caseId === "MEDIA-01") return { duration_300_seconds_allowed: steps.some((step) => step.status === 200 && step.data?.durationMs === 300_000) };
    if (caseId === "MEDIA-02") return { duration_over_300_seconds_blocked: statusBlocked(steps), provider_calls: 0 };
    if (caseId === "MEDIA-03") return { unreadable_metadata_blocked: statusBlocked(steps), provider_calls: 0 };
    if (caseId === "LEGACY-01") return {
      legacy_backfill_absent: sessions.some((value) => value.pipelineVersion == null && value.summary == null && value.report == null),
      legacy_delete_allowed: steps.some((step) => step.status === 202 && step.data?.status === "completed"),
    };
    if (caseId === "BLOCKED-01") return {
      all_observations_blocked: Boolean(session && Array.isArray(session.observations) && session.observations.length > 0 && session.observations.every((item) => item?.blockedForQuestioning === true)),
      report_not_created: reports.length === 0 && steps.some((step) => step.status === 404),
    };
    if (caseId === "PAUSE-01") return { manual_stop_paused: session?.interviewStatus === "paused" && session?.completionReason === "manual_stop_paused", report_not_created: reports.length === 0 && steps.some((step) => step.status === 404) };
    if (caseId === "MANUAL-01") return { manual_stop_report_ready: session?.interviewStatus === "completed" && session?.completionReason === "manual_stop_report_ready", reports_created: reports.length ? 1 : 0 };
    if (caseId === "BOUNDARY-05") return { no_normal_completion_before_five: turns.length >= 5 && turns.slice(0, 4).every((turn) => turn.done === false), fifth_answer_boundary_valid: turns[4]?.done === true };
    if (caseId === "BOUNDARY-10R") return { tenth_answer_terminal: turns.length >= 10 && turns.slice(0, 9).every((turn) => turn.done === false) && turns[9]?.done === true, report_ready: turns[9]?.reportReady === true, reports_created: reports.length ? 1 : 0 };
    if (caseId === "BOUNDARY-10N") return { tenth_answer_terminal: turns.length >= 10 && turns.slice(0, 9).every((turn) => turn.done === false) && turns[9]?.done === true, insufficient_interview_evidence: turns[9]?.completionReason === "insufficient_interview_evidence" && turns[9]?.reportReady === false, reports_created: reports.length };
    if (caseId === "COUNT-01") {
      const transcript = Array.isArray(session?.transcript) ? session.transcript : [];
      const answers = transcript.filter((turn) => turn?.role === "actor" && turn?.kind === "answer");
      const unknown = transcript.filter((turn) => turn?.role === "actor" && turn?.kind === "unknown");
      const notes = transcript.filter((turn) => turn?.role === "actor" && turn?.kind === "optional_note");
      const selected = new Set(Array.isArray(session?.reportEvidenceAnswerTurnIds) ? session.reportEvidenceAnswerTurnIds : []);
      return { answer_count_exact: session?.substantiveAnswerCount === answers.length, unknown_counts_only_toward_cap: answers.length + unknown.length === 10 && unknown.every((turn) => !selected.has(turn.id)), optional_note_excluded: notes.length === 1 && !selected.has(notes[0].id) };
    }
    if (caseId === "REPORT-01") {
      const fingerprints = reportValues(steps).map((value) => canonicalJson(value));
      const aggregates = sessions.filter((value) => value.summary && Array.isArray(value.transcript));
      const stableInputs = aggregates.length >= 2 && canonicalJson({ summary: aggregates[0].summary, transcript: aggregates[0].transcript }) === canonicalJson({ summary: aggregates.at(-1).summary, transcript: aggregates.at(-1).transcript });
      const reportRuns = Array.isArray(session?.runs) ? session.runs.filter((run) => run?.stage === "report" && run?.status === "completed") : [];
      return { successful_report_immutable: fingerprints.length >= 2 && fingerprints.every((value) => value === fingerprints[0]), failed_report_retry_reuses_inputs: stableInputs && steps.some((step) => step.status >= 500) && steps.some((step) => step.status === 200), successful_report_rows: reportRuns.length };
    }
    reject();
  };
  let optionalNoteConcurrencyAtomic = null;
  let optionalNoteRows = null;
  return Object.freeze({
    api,
    async runCase(caseId) {
      const plan = settings.scenarioPlans?.[caseId];
      if (!Array.isArray(plan)) reject("SCRIPTED_CASE_BAD_INPUT");
      const steps = [];
      for (let index = 0; index < plan.length;) {
        const group = plan[index].parallelGroup;
        if (group === null) {
          steps.push(await api(plan[index]));
          index += 1;
          continue;
        }
        const grouped = [];
        while (index < plan.length && plan[index].parallelGroup === group) grouped.push(plan[index++]);
        steps.push(...await Promise.all(grouped.map((step) => api(step))));
      }
      const value = measurements(caseId, steps);
      if (caseId === "COUNT-01") {
        const sessions = sessionValues(steps);
        const transcript = Array.isArray(sessions.at(-1)?.transcript) ? sessions.at(-1).transcript : [];
        const writes = plan.filter((step) => step.method === "PUT" && step.path.endsWith("/optional-note"));
        optionalNoteRows = transcript.filter((turn) => turn?.role === "actor" && turn?.kind === "optional_note").length;
        optionalNoteConcurrencyAtomic = writes.length === 2 && steps.filter((step, index) => plan[index]?.method === "PUT" && plan[index]?.path.endsWith("/optional-note") && step.status === 200).length === 2 && optionalNoteRows === 1;
      }
      return value;
    },
    async cleanup() {
      if (!Array.isArray(settings.cleanupPlan)) reject("SCRIPTED_CASE_CLEANUP_FAILED");
      for (const step of settings.cleanupPlan) {
        const response = await api(step);
        if (!new Set([200, 202, 404]).has(response.status)) reject("SCRIPTED_CASE_CLEANUP_FAILED");
      }
      return { cleaned: true };
    },
    async finish() {
      if (optionalNoteConcurrencyAtomic !== true || optionalNoteRows !== 1) reject();
      return { cleaned: true, optionalNoteConcurrencyAtomic, optionalNoteRows };
    },
  });
}

function validateScenarioAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || typeof adapter.runCase !== "function" ||
      typeof adapter.cleanup !== "function" || typeof adapter.finish !== "function") reject("SCRIPTED_CASE_BAD_INPUT");
  return adapter;
}

async function executeScenario(adapter, caseId, context) {
  let output;
  try { output = await adapter.runCase(caseId, context); } catch { reject(); }
  return validateMeasurements(caseId, output);
}

export async function runScriptedCases({
  settingsFd = SETTINGS_FD,
  macKeyFd = MAC_KEY_FD,
  receiptFd = RECEIPT_FD,
  adapterFactory = createLoopbackScenarioAdapter,
} = {}) {
  if (typeof adapterFactory !== "function") reject("SCRIPTED_CASE_BAD_INPUT");
  readPrivate(receiptFd, { empty: true });
  const key = readPrivate(macKeyFd, { maximum: 4096 });
  if (key.length < 32) { key.fill(0); reject("SCRIPTED_CASE_BAD_INPUT"); }
  let adapter = null;
  let receiptWritten = false;
  let failure = null;
  let receipt = null;
  const completed = new Map();
  try {
    const settingsRaw = readPrivate(settingsFd);
    let settings;
    try { settings = validateSettings(parseUniqueJson(settingsRaw), key); }
    finally { settingsRaw.fill(0); }
    adapter = validateScenarioAdapter(await adapterFactory(settings));
    for (const caseId of ["SAFE-01", "SRC-01", "DB-01"]) completed.set(caseId, settings.foundation[caseId]);
    let optionalNoteResult = null;
    for (const caseId of CASE_IDS.slice(4)) {
      const measured = await executeScenario(adapter, caseId, Object.freeze({ platformOrigin: settings.platformOrigin, timeoutMs: settings.timeoutMs }));
      completed.set(caseId, measured);
      if (caseId === "COUNT-01") optionalNoteResult = measured;
    }
    if (!optionalNoteResult) reject();
    const finished = await adapter.finish();
    if (!finished || finished.cleaned !== true || finished.optionalNoteConcurrencyAtomic !== true || finished.optionalNoteRows !== 1) reject("SCRIPTED_CASE_CLEANUP_FAILED");
    completed.set("DB-02", validateMeasurements("DB-02", {
      migration_postflight_exact: settings.foundation.migration_postflight_exact,
      optional_note_concurrency_atomic: finished.optionalNoteConcurrencyAtomic,
      optional_note_rows: finished.optionalNoteRows,
    }));
    const cases = CASE_IDS.map((caseId) => ({ caseId, measurements: completed.get(caseId) }));
    if (cases.some((item) => !item.measurements)) reject();
    const scenarioHmac = macJson(key, SCENARIO_DOMAIN, cases);
    const core = { schemaVersion: RECEIPT_SCHEMA, completed: true, caseCount: CASE_IDS.length, providerCredentialPresent: false, cleanupVerified: true, cases, scenarioHmac };
    receipt = { ...core, resultHmac: macJson(key, RECEIPT_DOMAIN, core) };
    writeReceipt(receiptFd, receipt);
    receiptWritten = true;
  } catch (error) {
    failure = error instanceof ScriptedCaseFailure ? error : new ScriptedCaseFailure();
  } finally {
    if (adapter !== null) {
      try {
        const cleaned = await adapter.cleanup();
        if (!cleaned || cleaned.cleaned !== true) failure = new ScriptedCaseFailure("SCRIPTED_CASE_CLEANUP_FAILED");
      } catch { failure = new ScriptedCaseFailure("SCRIPTED_CASE_CLEANUP_FAILED"); }
    }
    if (failure !== null && receiptWritten && !clearReceipt(receiptFd)) failure = new ScriptedCaseFailure("SCRIPTED_CASE_CLEANUP_FAILED");
    key.fill(0);
  }
  if (failure !== null) throw failure;
  if (receipt === null) reject();
  return receipt;
}

function clearInheritedEnvironment() {
  for (const key of Object.keys(process.env)) if (!new Set(["PATH", "LANG", "LC_ALL", "TZ"]).has(key)) delete process.env[key];
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly && process.argv.length === 2) {
  process.exitCode = 0;
} else if (invokedDirectly) {
  if (process.argv.length !== 3 || process.argv[2] !== "--live") process.exitCode = 70;
  else {
    clearInheritedEnvironment();
    runScriptedCases().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 70; });
  }
}
