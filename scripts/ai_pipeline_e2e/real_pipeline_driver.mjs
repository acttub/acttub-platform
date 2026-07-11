import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { assertDevelopmentTarget } from "./development_target.mjs";

const SETTINGS_FD = 3;
const MEDIA_FD = 4;
const MAC_KEY_FD = 5;
const RECEIPT_FD = 6;
const HANDOFF_FD = 7;
const HANDOFF_ACK_FD = 8;
const CLEANUP_FD = 9;

export const MAX_SETTINGS_BYTES = 128 * 1024;
export const MAX_MEDIA_BYTES = 300 * 1024 * 1024;
export const MAX_HTTP_BYTES = 2 * 1024 * 1024;
export const MAX_JSON_DEPTH = 16;
export const MAX_JSON_ITEMS = 8192;
export const SETTINGS_SCHEMA = "real-pipeline-settings.v1";
export const RECEIPT_SCHEMA = "real-pipeline-receipt.v1";
export const HANDOFF_SCHEMA = "browser-session-handoff.v1";
export const HANDOFF_ACK_SCHEMA = "browser-session-handoff-receipt.v1";
export const CLEANUP_PLAN_SCHEMA = "cleanup-plan.v1";
export const CLEANUP_PLAN_ACK_SCHEMA = "cleanup-plan-ack.v1";
export const CLEANUP_COMPLETE_SCHEMA = "cleanup-complete.v1";
export const CLEANUP_COMPLETE_ACK_SCHEMA = "cleanup-complete-ack.v1";

const HMAC_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const TEMPORARY_EMAIL_PREFIX = "acttub-e2e-";
const MEDIA_DOMAIN = Buffer.from("acttub-platform-media.v1\0", "ascii");
const RECEIPT_DOMAIN = Buffer.from("acttub-real-pipeline-receipt.v1\0", "ascii");
const LINEAGE_DOMAIN = Buffer.from("acttub-real-pipeline-lineage.v1\0", "ascii");
const REPORT_DOMAIN = Buffer.from("acttub-real-pipeline-report.v1\0", "ascii");
const BROWSER_BINDING_DOMAIN = Buffer.from("acttub-browser-binding.v1\0", "ascii");
const HANDOFF_RECEIPT_DOMAIN = Buffer.from("acttub-browser-session-handoff-receipt.v1\0", "ascii");
const HANDOFF_NONCE_DOMAIN = Buffer.from("acttub-browser-session-handoff-nonce.v1\0", "ascii");
const HANDOFF_TARGET_DOMAIN = Buffer.from("acttub-browser-session-handoff-target.v1\0", "ascii");
const SAFE_CODES = new Set([
  "REAL_PIPELINE_BAD_INPUT",
  "REAL_PIPELINE_AUTH_FAILED",
  "REAL_PIPELINE_HTTP_FAILED",
  "REAL_PIPELINE_CONTRACT_FAILED",
  "REAL_PIPELINE_CLEANUP_FAILED",
]);

const SCENE_CONTEXT = Object.freeze({
  genre: "연극",
  situation: "시각장애인이 사랑하는 마음을 숨기는 상황",
  characterContext: "시각장애가 있는 인물이 오래 사랑해 온 상대와 단둘이 있다. 지금의 관계를 잃을까 두려워 자신의 마음을 숨기려 한다.",
  subtext: "좋아한다고 말하고 싶지만 지금의 관계도 잃고 싶지 않다.",
});

const SCENARIO_ANSWERS = Object.freeze([
  "이 인물은 관계가 끊어질까 두려워서 마음을 바로 말하지 못합니다.",
  "상대에게 다가가고 싶지만 지금의 편안한 관계가 사라질까 봐 거리를 둡니다.",
  "침묵이 길어지는 순간에는 고백하려는 충동과 숨기려는 선택이 충돌합니다.",
  "목소리를 낮춘 것은 감정을 들키지 않으면서 상대의 반응을 확인하려는 선택입니다.",
  "결국 원하는 것은 사랑을 전하는 일이지만 먼저 관계가 안전한지 확인하고 싶습니다.",
  "상대가 머무른다는 확신이 생기면 감정을 조금 더 직접적으로 표현할 수 있습니다.",
  "움직임을 멈춘 순간은 관계를 잃을 가능성을 상상하고 선택을 다시 미루는 지점입니다.",
  "인물에게 필요한 변화는 두려움을 없애는 것이 아니라 두려운 상태에서도 한 걸음 말하는 것입니다.",
  "다음 시도에서는 같은 대사 전에 상대의 존재를 확인하는 호흡을 더 분명히 두겠습니다.",
  "마지막에는 결과를 통제하려 하지 않고 지금의 진심을 상대에게 맡기려 합니다.",
]);

const REPORT_SECTION_KEYS = Object.freeze([
  "oneLineSummary",
  "primaryReviewPoint",
  "confirmedEvidence",
  "actorDiscovery",
  "groundedEncouragement",
  "nextPracticeStep",
]);

const SESSION_DEPENDENT_TABLES = Object.freeze([
  "practice_takes",
  "observations",
  "question_turns",
  "session_results",
  "validation_events",
  "ai_runs",
  "ai_session_summaries",
  "interview_turns",
  "actor_corrections",
  "ai_reports",
]);

export class RealPipelineFailure extends Error {
  constructor(safeCode = "REAL_PIPELINE_CONTRACT_FAILED") {
    const code = SAFE_CODES.has(safeCode) ? safeCode : "REAL_PIPELINE_CONTRACT_FAILED";
    super(code);
    this.name = "RealPipelineFailure";
    this.safeCode = code;
  }
}

function reject(safeCode = "REAL_PIPELINE_CONTRACT_FAILED") {
  throw new RealPipelineFailure(safeCode);
}

function validateTree(value, depth = 0, counter = { count: 0 }) {
  counter.count += 1;
  if (depth > MAX_JSON_DEPTH || counter.count > MAX_JSON_ITEMS) reject("REAL_PIPELINE_BAD_INPUT");
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value))) return;
  if (typeof value === "string") {
    if (value.includes("\0") || Buffer.byteLength(value, "utf8") > MAX_HTTP_BYTES) reject("REAL_PIPELINE_BAD_INPUT");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ITEMS) reject("REAL_PIPELINE_BAD_INPUT");
    for (const item of value) validateTree(item, depth + 1, counter);
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > MAX_JSON_ITEMS) reject("REAL_PIPELINE_BAD_INPUT");
    for (const key of keys) {
      if (!key || key.includes("\0") || Buffer.byteLength(key, "utf8") > 256) reject("REAL_PIPELINE_BAD_INPUT");
      validateTree(value[key], depth + 1, counter);
    }
    return;
  }
  reject("REAL_PIPELINE_BAD_INPUT");
}

function parseUniqueJson(input, maximum = MAX_HTTP_BYTES) {
  if (!Buffer.isBuffer(input) || input.length < 1 || input.length > maximum) reject("REAL_PIPELINE_BAD_INPUT");
  const source = input.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(input)) reject("REAL_PIPELINE_BAD_INPUT");
  let cursor = 0;
  let itemCount = 0;
  const whitespace = () => {
    while ([" ", "\n", "\r", "\t"].includes(source[cursor])) cursor += 1;
  };
  const stringValue = () => {
    if (source[cursor] !== '"') reject("REAL_PIPELINE_BAD_INPUT");
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code < 0x20) reject("REAL_PIPELINE_BAD_INPUT");
      if (source[cursor] === '"') {
        cursor += 1;
        let parsed;
        try { parsed = JSON.parse(source.slice(start, cursor)); } catch { reject("REAL_PIPELINE_BAD_INPUT"); }
        if (typeof parsed !== "string" || parsed.includes("\0") || Buffer.byteLength(parsed, "utf8") > maximum) reject("REAL_PIPELINE_BAD_INPUT");
        return parsed;
      }
      if (source[cursor] === "\\") {
        cursor += 1;
        if (cursor >= source.length || !'"\\/bfnrtu'.includes(source[cursor])) reject("REAL_PIPELINE_BAD_INPUT");
        if (source[cursor] === "u") {
          if (!/^[a-fA-F0-9]{4}$/u.test(source.slice(cursor + 1, cursor + 5))) reject("REAL_PIPELINE_BAD_INPUT");
          cursor += 4;
        }
      }
      cursor += 1;
    }
    reject("REAL_PIPELINE_BAD_INPUT");
  };
  const value = (depth) => {
    if (depth > MAX_JSON_DEPTH) reject("REAL_PIPELINE_BAD_INPUT");
    whitespace();
    if (source[cursor] === '"') return stringValue();
    if (source[cursor] === "{") {
      cursor += 1;
      const result = Object.create(null);
      const keys = new Set();
      whitespace();
      if (source[cursor] === "}") { cursor += 1; return result; }
      while (cursor < source.length) {
        whitespace();
        const key = stringValue();
        if (keys.has(key)) reject("REAL_PIPELINE_BAD_INPUT");
        keys.add(key);
        itemCount += 1;
        if (itemCount > MAX_JSON_ITEMS) reject("REAL_PIPELINE_BAD_INPUT");
        whitespace();
        if (source[cursor] !== ":") reject("REAL_PIPELINE_BAD_INPUT");
        cursor += 1;
        result[key] = value(depth + 1);
        whitespace();
        if (source[cursor] === "}") { cursor += 1; return result; }
        if (source[cursor] !== ",") reject("REAL_PIPELINE_BAD_INPUT");
        cursor += 1;
      }
      reject("REAL_PIPELINE_BAD_INPUT");
    }
    if (source[cursor] === "[") {
      cursor += 1;
      const result = [];
      whitespace();
      if (source[cursor] === "]") { cursor += 1; return result; }
      while (cursor < source.length) {
        itemCount += 1;
        if (itemCount > MAX_JSON_ITEMS) reject("REAL_PIPELINE_BAD_INPUT");
        result.push(value(depth + 1));
        whitespace();
        if (source[cursor] === "]") { cursor += 1; return result; }
        if (source[cursor] !== ",") reject("REAL_PIPELINE_BAD_INPUT");
        cursor += 1;
      }
      reject("REAL_PIPELINE_BAD_INPUT");
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(literal, cursor)) { cursor += literal.length; return parsed; }
    }
    const match = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)/u);
    if (!match) reject("REAL_PIPELINE_BAD_INPUT");
    cursor += match[0].length;
    const parsed = Number(match[0]);
    if (!Number.isSafeInteger(parsed)) reject("REAL_PIPELINE_BAD_INPUT");
    return parsed;
  };
  const parsed = value(0);
  whitespace();
  if (cursor !== source.length) reject("REAL_PIPELINE_BAD_INPUT");
  validateTree(parsed);
  return parsed;
}

function asciiString(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/gu, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function canonicalJson(value) {
  validateTree(value);
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return asciiString(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${asciiString(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactObject(value, keys, safeCode = "REAL_PIPELINE_CONTRACT_FAILED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(safeCode);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject(safeCode);
  return value;
}

function readPrivateRegular(fd, maximum) {
  if (!Number.isInteger(fd) || fd <= 2) reject("REAL_PIPELINE_BAD_INPUT");
  let info;
  try { info = fs.fstatSync(fd); } catch { reject("REAL_PIPELINE_BAD_INPUT"); }
  if (!info.isFile() || info.size < 1 || info.size > maximum || info.nlink > 1) reject("REAL_PIPELINE_BAD_INPUT");
  if (typeof process.geteuid === "function" && info.uid !== process.geteuid()) reject("REAL_PIPELINE_BAD_INPUT");
  if ((info.mode & 0o077) !== 0) reject("REAL_PIPELINE_BAD_INPUT");
  const output = Buffer.alloc(info.size);
  let offset = 0;
  while (offset < output.length) {
    let count;
    try { count = fs.readSync(fd, output, offset, output.length - offset, offset); } catch { reject("REAL_PIPELINE_BAD_INPUT"); }
    if (count <= 0) reject("REAL_PIPELINE_BAD_INPUT");
    offset += count;
  }
  return output;
}

function writablePrivateFd(fd, { optional = false, streamOnly = false } = {}) {
  if (!Number.isInteger(fd) || fd <= 2) {
    if (optional) return null;
    reject("REAL_PIPELINE_BAD_INPUT");
  }
  let info;
  try { info = fs.fstatSync(fd); } catch {
    if (optional) return null;
    reject("REAL_PIPELINE_BAD_INPUT");
  }
  const privateFile = info.isFile() && info.nlink <= 1 && (info.mode & 0o077) === 0 &&
    (typeof process.geteuid !== "function" || info.uid === process.geteuid());
  const privateStream = info.isFIFO() || info.isSocket();
  if ((streamOnly && !privateStream) || (!streamOnly && !privateFile && !privateStream)) reject("REAL_PIPELINE_BAD_INPUT");
  return info;
}

function writePrivateJson(fd, value, { optional = false, streamOnly = false } = {}) {
  const info = writablePrivateFd(fd, { optional, streamOnly });
  if (info === null) return false;
  const encoded = Buffer.from(`${canonicalJson(value)}\n`, "ascii");
  if (encoded.length > MAX_SETTINGS_BYTES) reject("REAL_PIPELINE_BAD_INPUT");
  try {
    if (info.isFile()) { fs.ftruncateSync(fd, 0); fs.writeSync(fd, encoded, 0, encoded.length, 0); fs.fsyncSync(fd); }
    else {
      let offset = 0;
      while (offset < encoded.length) offset += fs.writeSync(fd, encoded, offset, encoded.length - offset, null);
    }
  } catch { reject("REAL_PIPELINE_BAD_INPUT"); }
  finally { encoded.fill(0); }
  return true;
}

function validateEmptyReceiptFd(fd) {
  const info = writablePrivateFd(fd);
  if (!info.isFile() || info.size !== 0) reject("REAL_PIPELINE_BAD_INPUT");
  try { fs.ftruncateSync(fd, 0); fs.fsyncSync(fd); }
  catch { reject("REAL_PIPELINE_BAD_INPUT"); }
}

function clearPrivateReceipt(fd) {
  try { fs.ftruncateSync(fd, 0); fs.fsyncSync(fd); }
  catch { return false; }
  return true;
}

function readPrivateStreamJson(fd, maximum = MAX_SETTINGS_BYTES, timeoutMs = 30_000) {
  writablePrivateFd(fd, { streamOnly: true });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) reject("REAL_PIPELINE_BAD_INPUT");
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const stream = fs.createReadStream(null, { fd, autoClose: false });
    let timer;
    const finish = (value, failed = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stream.pause();
      stream.removeAllListeners();
      for (const chunk of chunks) chunk.fill(0);
      if (failed) rejectPromise(new RealPipelineFailure("REAL_PIPELINE_AUTH_FAILED"));
      else resolvePromise(value);
    };
    timer = setTimeout(() => finish(null, true), timeoutMs);
    stream.on("data", (value) => {
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximum) { chunk.fill(0); finish(null, true); return; }
      chunks.push(chunk);
      const combined = Buffer.concat(chunks, total);
      const newline = combined.indexOf(0x0a);
      if (newline < 0) { combined.fill(0); return; }
      if (newline !== combined.length - 1 || newline < 1) { combined.fill(0); finish(null, true); return; }
      let parsed;
      try { parsed = parseUniqueJson(combined.subarray(0, newline), maximum); }
      catch { combined.fill(0); finish(null, true); return; }
      combined.fill(0);
      finish(parsed);
    });
    stream.once("end", () => finish(null, true));
    stream.once("error", () => finish(null, true));
  });
}

function hmacBytes(key, domain, bytes) {
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(domain).update(bytes).digest("hex")}`;
}

function hmacJson(key, domain, value) {
  return hmacBytes(key, domain, Buffer.from(canonicalJson(value), "ascii"));
}

function timingEqual(left, right) {
  return typeof left === "string" && typeof right === "string" && left.length === right.length &&
    crypto.timingSafeEqual(Buffer.from(left, "ascii"), Buffer.from(right, "ascii"));
}

function readSettings(fd, key) {
  const raw = readPrivateRegular(fd, MAX_SETTINGS_BYTES);
  try {
    const item = exactObject(parseUniqueJson(raw, MAX_SETTINGS_BYTES), [
      "schemaVersion", "platformOrigin", "supabaseUrl", "publishableKey", "serviceRoleKey",
      "storageBucket", "mimeType", "maximumMediaBytes", "expectedMediaHmac",
      "developmentTargetHmac", "browserHandoff",
    ], "REAL_PIPELINE_BAD_INPUT");
    if (item.schemaVersion !== SETTINGS_SCHEMA) reject("REAL_PIPELINE_BAD_INPUT");
    for (const field of ["platformOrigin", "supabaseUrl", "publishableKey", "serviceRoleKey", "storageBucket", "mimeType", "expectedMediaHmac", "developmentTargetHmac"]) {
      if (typeof item[field] !== "string" || !item[field] || item[field].includes("\0") || Buffer.byteLength(item[field], "utf8") > 16 * 1024) reject("REAL_PIPELINE_BAD_INPUT");
    }
    let platform;
    let supabase;
    try { platform = new URL(item.platformOrigin); supabase = new URL(item.supabaseUrl); } catch { reject("REAL_PIPELINE_BAD_INPUT"); }
    if (platform.protocol !== "http:" || !new Set(["127.0.0.1", "::1", "localhost"]).has(platform.hostname) || platform.username || platform.password || platform.search || platform.hash || !["", "/"].includes(platform.pathname)) reject("REAL_PIPELINE_BAD_INPUT");
    try { assertDevelopmentTarget(key, supabase.origin, item.developmentTargetHmac); }
    catch { reject("REAL_PIPELINE_BAD_INPUT"); }
    if (item.storageBucket !== "practice-videos" || !new Set(["video/mp4", "video/quicktime"]).has(item.mimeType)) reject("REAL_PIPELINE_BAD_INPUT");
    if (!Number.isSafeInteger(item.maximumMediaBytes) || item.maximumMediaBytes < 1 || item.maximumMediaBytes > MAX_MEDIA_BYTES) reject("REAL_PIPELINE_BAD_INPUT");
    if (!HMAC_PATTERN.test(item.expectedMediaHmac) || !HMAC_PATTERN.test(item.developmentTargetHmac)) reject("REAL_PIPELINE_BAD_INPUT");
    if (item.browserHandoff !== null) {
      const handoff = exactObject(item.browserHandoff, ["nonce", "brokerPort", "targetPort"], "REAL_PIPELINE_BAD_INPUT");
      if (!NONCE_PATTERN.test(handoff.nonce)) reject("REAL_PIPELINE_BAD_INPUT");
      for (const port of [handoff.brokerPort, handoff.targetPort]) {
        if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) reject("REAL_PIPELINE_BAD_INPUT");
      }
    }
    return Object.freeze({ ...item, platformOrigin: platform.origin, supabaseUrl: supabase.origin });
  } finally { raw.fill(0); }
}

function requireUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) reject();
  return value;
}

function requireText(value, maximum = 64 * 1024) {
  if (typeof value !== "string" || !value || value.includes("\0") || Buffer.byteLength(value, "utf8") > maximum) reject();
  return value;
}

function requireSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("REAL_PIPELINE_AUTH_FAILED");
  const accessToken = requireText(value.accessToken);
  const refreshToken = requireText(value.refreshToken);
  requireUuid(value.userId);
  if (!value.cookieJar || typeof value.cookieJar.header !== "function") reject("REAL_PIPELINE_AUTH_FAILED");
  return { ...value, accessToken, refreshToken };
}

function requireApiResult(value, statuses) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger(value.status) || !statuses.includes(value.status) || !("data" in value)) reject("REAL_PIPELINE_HTTP_FAILED");
  validateTree(value.data);
  return value.data;
}

function actorProgress(session) {
  if (!session || typeof session !== "object" || Array.isArray(session) || !Array.isArray(session.transcript) || !Number.isInteger(session.substantiveAnswerCount)) reject();
  const total = session.transcript.filter((turn) => turn && turn.role === "actor" && (turn.kind === "answer" || turn.kind === "unknown")).length;
  if (session.substantiveAnswerCount < 0 || session.substantiveAnswerCount > total || total > 10) reject();
  return { substantive: session.substantiveAnswerCount, total };
}

function validateReport(report) {
  const item = exactObject(report, ["sessionId", "sourceRunId", "schemaVersion", "completionReason", "createdAt", ...REPORT_SECTION_KEYS]);
  if (item.schemaVersion !== "report.v1" || !item.completionReason?.endsWith("_report_ready")) reject();
  requireUuid(item.sessionId);
  requireUuid(item.sourceRunId);
  requireText(item.createdAt, 256);
  for (const key of REPORT_SECTION_KEYS) {
    const section = exactObject(item[key], ["status", "content", "observationEvidenceIds", "turnEvidenceIds", "timestampRange"]);
    if (!new Set(["confirmed", "not_confirmed"]).has(section.status) || !Array.isArray(section.observationEvidenceIds) || !Array.isArray(section.turnEvidenceIds)) reject();
    if (!section.observationEvidenceIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) || !section.turnEvidenceIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))) reject();
    if (section.status === "confirmed" ? typeof section.content !== "string" || !section.content.trim() : section.content !== null) reject();
    if (section.timestampRange !== null) {
      const range = exactObject(section.timestampRange, ["startMs", "endMs"]);
      if (!Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) || range.startMs < 0 || range.endMs < range.startMs) reject();
    }
  }
  return item;
}

function validateLineage(session, report) {
  if (!session || typeof session !== "object" || Array.isArray(session) || !session.summary || !Array.isArray(session.observations) || !Array.isArray(session.transcript) || !Array.isArray(session.runs)) reject();
  const summaryRunId = requireUuid(session.summary.sourceRunId);
  const summaryRuns = session.runs.filter((run) => run && run.stage === "summary" && run.status === "completed" && run.id === summaryRunId);
  const agentRuns = session.runs.filter((run) => run && run.stage === "agent" && run.status === "completed");
  const reportRuns = session.runs.filter((run) => run && run.stage === "report" && run.status === "completed");
  if (summaryRuns.length !== 1 || agentRuns.length < 5 || reportRuns.length !== 1) reject();
  const accepted = session.observations.filter((observation) => observation && observation.confirmationState === "accepted" && observation.blockedForQuestioning === false);
  if (accepted.length < 1 || accepted.some((observation) => observation.sourceRunId !== summaryRunId)) reject();
  const acceptedIds = new Set(accepted.map((observation) => requireUuid(observation.id)));
  const answerIds = new Set(session.transcript.filter((turn) => turn && turn.role === "actor" && turn.kind === "answer").map((turn) => requireUuid(turn.id)));
  if (!Array.isArray(session.reportEvidenceObservationIds) || !Array.isArray(session.reportEvidenceAnswerTurnIds) || session.reportEvidenceObservationIds.length < 1 || session.reportEvidenceAnswerTurnIds.length < 1) reject();
  if (!session.reportEvidenceObservationIds.every((id) => acceptedIds.has(id)) || !session.reportEvidenceAnswerTurnIds.every((id) => answerIds.has(id))) reject();
  for (const section of REPORT_SECTION_KEYS.map((key) => report[key])) {
    if (!section.observationEvidenceIds.every((id) => acceptedIds.has(id)) || !section.turnEvidenceIds.every((id) => answerIds.has(id))) reject();
  }
  return {
    summaryRunId,
    acceptedObservationIds: [...acceptedIds].sort(),
    answerTurnIds: [...answerIds].sort(),
    reportEvidenceObservationIds: [...session.reportEvidenceObservationIds].sort(),
    reportEvidenceAnswerTurnIds: [...session.reportEvidenceAnswerTurnIds].sort(),
    completedRunIds: session.runs.filter((run) => run?.status === "completed").map((run) => requireUuid(run.id)).sort(),
  };
}

function validateReceipt(value) {
  const item = exactObject(value, [
    "schemaVersion", "completed", "mainSessionCount", "substantiveAnswerCount", "reportSectionCount",
    "acceptedObservationCount", "crossUserDenied", "crossUserDeniedOperationCount", "replayVerified",
    "immutableReportVerified", "browserHandoffAcknowledged",
    "deletionLifecycleVerified", "temporaryUserDeleted", "mediaByteCount", "mediaHmac", "lineageHmac",
    "reportHmac", "browserBindingHmac", "resultHmac",
  ]);
  if (item.schemaVersion !== RECEIPT_SCHEMA || item.completed !== true || item.mainSessionCount !== 1 || item.reportSectionCount !== 6 || item.acceptedObservationCount < 1 || item.crossUserDenied !== true || item.crossUserDeniedOperationCount !== 3 || item.replayVerified !== true || item.immutableReportVerified !== true || typeof item.browserHandoffAcknowledged !== "boolean" || item.deletionLifecycleVerified !== true || item.temporaryUserDeleted !== true) reject();
  if (!Number.isSafeInteger(item.substantiveAnswerCount) || item.substantiveAnswerCount < 5 || item.substantiveAnswerCount > 10 || !Number.isSafeInteger(item.mediaByteCount) || item.mediaByteCount < 1 || item.mediaByteCount > MAX_MEDIA_BYTES) reject();
  for (const field of ["mediaHmac", "lineageHmac", "reportHmac", "browserBindingHmac", "resultHmac"]) if (!HMAC_PATTERN.test(item[field])) reject();
  return item;
}

function validateHandoffAck(value, key, expected) {
  const item = exactObject(value, [
    "schemaVersion", "operation", "success", "cookieCount", "cookieHeadersHmac",
    "nonceHmac", "targetHmac", "developmentTargetHmac", "resultHmac",
  ], "REAL_PIPELINE_AUTH_FAILED");
  if (item.schemaVersion !== HANDOFF_ACK_SCHEMA || item.operation !== "browser_session_handoff" || item.success !== true || !Number.isSafeInteger(item.cookieCount) || item.cookieCount < 1 || item.cookieCount > 16) reject("REAL_PIPELINE_AUTH_FAILED");
  for (const field of ["cookieHeadersHmac", "nonceHmac", "targetHmac", "developmentTargetHmac", "resultHmac"]) {
    if (!HMAC_PATTERN.test(item[field])) reject("REAL_PIPELINE_AUTH_FAILED");
  }
  const target = Buffer.from(`127.0.0.1\0${expected.targetPort}\0${expected.targetPath}`, "ascii");
  try {
    if (!timingEqual(item.nonceHmac, hmacBytes(key, HANDOFF_NONCE_DOMAIN, Buffer.from(expected.nonce, "ascii"))) ||
        !timingEqual(item.targetHmac, hmacBytes(key, HANDOFF_TARGET_DOMAIN, target)) ||
        !timingEqual(item.developmentTargetHmac, expected.developmentTargetHmac)) reject("REAL_PIPELINE_AUTH_FAILED");
    const semantic = { ...item };
    delete semantic.resultHmac;
    if (!timingEqual(item.resultHmac, hmacJson(key, HANDOFF_RECEIPT_DOMAIN, semantic))) reject("REAL_PIPELINE_AUTH_FAILED");
  } finally { target.fill(0); }
  return item;
}

function validateCleanupPlanAck(value, resourceAlias) {
  const item = exactObject(value, ["schemaVersion", "operation", "resourceAlias", "planReceiptHmac"], "REAL_PIPELINE_CLEANUP_FAILED");
  if (item.schemaVersion !== CLEANUP_PLAN_ACK_SCHEMA || item.operation !== "plan" || item.resourceAlias !== resourceAlias || !HMAC_PATTERN.test(item.planReceiptHmac)) reject("REAL_PIPELINE_CLEANUP_FAILED");
  return item;
}

async function planCleanup(cleanupChannel, resourceAlias, locator, outcomePolicy) {
  if (!Array.isArray(outcomePolicy) || outcomePolicy.length < 1) reject("REAL_PIPELINE_CLEANUP_FAILED");
  return validateCleanupPlanAck(await cleanupChannel.exchange({ schemaVersion: CLEANUP_PLAN_SCHEMA, operation: "plan", resourceAlias, locator, outcomePolicy }), resourceAlias).planReceiptHmac;
}

class CleanupChannel {
  constructor(fd, timeoutMs) {
    const info = writablePrivateFd(fd, { streamOnly: true });
    if (!info?.isSocket() || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) reject("REAL_PIPELINE_BAD_INPUT");
    this.socket = new net.Socket({ fd, readable: true, writable: true });
    this.timeoutMs = timeoutMs;
    this.poisoned = false;
    this.active = false;
  }

  poison() {
    this.poisoned = true;
    this.socket.destroy();
  }

  async exchange(value) {
    if (this.poisoned || this.active) reject("REAL_PIPELINE_CLEANUP_FAILED");
    this.active = true;
    const request = Buffer.from(`${canonicalJson(value)}\n`, "ascii");
    if (request.length > MAX_SETTINGS_BYTES) { request.fill(0); this.poison(); reject("REAL_PIPELINE_CLEANUP_FAILED"); }
    const chunks = [];
    let total = 0;
    try {
      return await new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        const finish = (result, failed) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.socket.off("data", onData);
          this.socket.off("error", onFailure);
          this.socket.off("end", onFailure);
          for (const chunk of chunks) chunk.fill(0);
          if (failed) { this.poison(); rejectPromise(new RealPipelineFailure("REAL_PIPELINE_CLEANUP_FAILED")); }
          else resolvePromise(result);
        };
        const onFailure = () => finish(null, true);
        const onData = (value) => {
          const chunk = Buffer.from(value);
          total += chunk.length;
          if (total > MAX_SETTINGS_BYTES) { chunk.fill(0); finish(null, true); return; }
          chunks.push(chunk);
          const combined = Buffer.concat(chunks, total);
          const newline = combined.indexOf(0x0a);
          if (newline < 0) { combined.fill(0); return; }
          if (newline < 1 || newline !== combined.length - 1) { combined.fill(0); finish(null, true); return; }
          let parsed;
          try { parsed = parseUniqueJson(combined.subarray(0, newline), MAX_SETTINGS_BYTES); }
          catch { combined.fill(0); finish(null, true); return; }
          combined.fill(0);
          finish(parsed, false);
        };
        const timer = setTimeout(() => finish(null, true), this.timeoutMs);
        this.socket.on("data", onData);
        this.socket.once("error", onFailure);
        this.socket.once("end", onFailure);
        this.socket.write(request, (error) => {
          request.fill(0);
          if (error) finish(null, true);
        });
      });
    } finally { request.fill(0); this.active = false; }
  }

  close() { this.socket.destroy(); }
}

async function completeCleanup(cleanupChannel, resourceAlias, planReceiptHmac, outcome) {
  if (!HMAC_PATTERN.test(planReceiptHmac) || !new Set(["retained", "deleted", "absent", "not_created"]).has(outcome)) reject("REAL_PIPELINE_CLEANUP_FAILED");
  const ack = exactObject(await cleanupChannel.exchange({ schemaVersion: CLEANUP_COMPLETE_SCHEMA, operation: "complete", resourceAlias, planReceiptHmac, outcome }), ["schemaVersion", "operation", "resourceAlias", "planReceiptHmac", "outcome"], "REAL_PIPELINE_CLEANUP_FAILED");
  if (ack.schemaVersion !== CLEANUP_COMPLETE_ACK_SCHEMA || ack.operation !== "complete" || ack.resourceAlias !== resourceAlias || !timingEqual(ack.planReceiptHmac, planReceiptHmac) || ack.outcome !== outcome) reject("REAL_PIPELINE_CLEANUP_FAILED");
}

class CookieJar {
  constructor() { this.values = new Map(); }
  getAll() { return [...this.values.entries()].map(([name, value]) => ({ name, value })); }
  setAll(cookies) {
    if (!Array.isArray(cookies)) reject("REAL_PIPELINE_AUTH_FAILED");
    for (const cookie of cookies) {
      if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string" || !/^[A-Za-z0-9_.-]{1,256}$/u.test(cookie.name) || cookie.value.includes("\0") || Buffer.byteLength(cookie.value, "utf8") > 64 * 1024) reject("REAL_PIPELINE_AUTH_FAILED");
      if (cookie.value === "") this.values.delete(cookie.name); else this.values.set(cookie.name, cookie.value);
    }
  }
  header() {
    const value = [...this.values.entries()].map(([name, item]) => `${name}=${item}`).join("; ");
    if (!value || Buffer.byteLength(value, "utf8") > 128 * 1024) reject("REAL_PIPELINE_AUTH_FAILED");
    return value;
  }
  applySetCookie(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : (() => { const one = headers.get("set-cookie"); return one ? [one] : []; })();
    for (const raw of values) {
      if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 64 * 1024) reject("REAL_PIPELINE_HTTP_FAILED");
      const pair = raw.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator < 1) reject("REAL_PIPELINE_HTTP_FAILED");
      this.setAll([{ name: pair.slice(0, separator), value: pair.slice(separator + 1) }]);
    }
  }
}

async function readResponseBody(response) {
  if (!response.body || typeof response.body.getReader !== "function") reject("REAL_PIPELINE_HTTP_FAILED");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) reject("REAL_PIPELINE_HTTP_FAILED");
    total += value.byteLength;
    if (total > MAX_HTTP_BYTES) reject("REAL_PIPELINE_HTTP_FAILED");
    chunks.push(Buffer.from(value));
  }
  if (total < 1) reject("REAL_PIPELINE_HTTP_FAILED");
  return parseUniqueJson(Buffer.concat(chunks, total), MAX_HTTP_BYTES);
}

async function defaultAdapterFactory(settings, { temporaryEmail }) {
  let supabaseModule;
  let ssrModule;
  try {
    supabaseModule = await import(new URL("../../apps/web/node_modules/@supabase/supabase-js/dist/index.mjs", import.meta.url));
    ssrModule = await import(new URL("../../apps/web/node_modules/@supabase/ssr/dist/module/index.js", import.meta.url));
  } catch { reject("REAL_PIPELINE_AUTH_FAILED"); }
  if (typeof supabaseModule.createClient !== "function" || typeof ssrModule.createServerClient !== "function") reject("REAL_PIPELINE_AUTH_FAILED");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = supabaseModule.createClient(settings.supabaseUrl, settings.serviceRoleKey, options);
  let temporaryUserId = null;

  const checked = (result, code = "REAL_PIPELINE_AUTH_FAILED") => {
    if (!result || result.error) reject(code);
    return result.data;
  };
  const listUsers = async () => {
    const users = [];
    for (let page = 1; page <= 10; page += 1) {
      const data = checked(await admin.auth.admin.listUsers({ page, perPage: 1000 }));
      if (!Array.isArray(data?.users)) reject("REAL_PIPELINE_AUTH_FAILED");
      users.push(...data.users);
      if (data.users.length < 1000) break;
      if (page === 10) reject("REAL_PIPELINE_AUTH_FAILED");
    }
    return users;
  };
  const findTemporaryUsers = async () => {
    const matches = (await listUsers()).filter((user) => user?.email === temporaryEmail && typeof user.id === "string");
    if (matches.length > 1) reject("REAL_PIPELINE_AUTH_FAILED");
    return matches;
  };
  const findPrimaryUser = async () => {
    const matches = (await listUsers()).filter((user) =>
      typeof user?.id === "string" && UUID_PATTERN.test(user.id) &&
      typeof user.email === "string" && !user.email.startsWith(TEMPORARY_EMAIL_PREFIX) &&
      !user.deleted_at && user.is_anonymous !== true && Boolean(user.email_confirmed_at || user.confirmed_at),
    );
    if (matches.length !== 1) reject("REAL_PIPELINE_AUTH_FAILED");
    return matches[0];
  };
  const authenticateEmail = async (email, expectedUserId) => {
    const generated = checked(await admin.auth.admin.generateLink({ type: "magiclink", email }));
    const tokenHash = generated?.properties?.hashed_token;
    if (typeof tokenHash !== "string" || !tokenHash) reject("REAL_PIPELINE_AUTH_FAILED");
    const client = supabaseModule.createClient(settings.supabaseUrl, settings.publishableKey, options);
    const verified = checked(await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }));
    const session = verified?.session;
    const user = verified?.user;
    if (!session?.access_token || !session?.refresh_token || user?.id !== expectedUserId) reject("REAL_PIPELINE_AUTH_FAILED");
    const cookieJar = new CookieJar();
    const ssr = ssrModule.createServerClient(settings.supabaseUrl, settings.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      cookies: { getAll: () => cookieJar.getAll(), setAll: (cookies) => cookieJar.setAll(cookies) },
    });
    const installed = await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (installed.error || !installed.data?.session) reject("REAL_PIPELINE_AUTH_FAILED");
    return { userId: expectedUserId, accessToken: session.access_token, refreshToken: session.refresh_token, cookieJar, client };
  };
  return {
    async establishExistingPrimary() {
      const user = await findPrimaryUser();
      return authenticateEmail(user.email, user.id);
    },
    async createTemporaryUserSession(expectedEmail) {
      if (expectedEmail !== temporaryEmail) reject("REAL_PIPELINE_AUTH_FAILED");
      if (temporaryUserId !== null) reject("REAL_PIPELINE_AUTH_FAILED");
      const created = checked(await admin.auth.admin.createUser({ email: temporaryEmail, email_confirm: true }));
      if (!created?.user?.id) reject("REAL_PIPELINE_AUTH_FAILED");
      temporaryUserId = created.user.id;
      return authenticateEmail(temporaryEmail, temporaryUserId);
    },
    async deleteTemporaryUser() {
      if (temporaryUserId === null) {
        const matches = await findTemporaryUsers();
        if (matches.length === 0) return { deleted: true, deletedCount: 0 };
        temporaryUserId = matches[0].id;
      }
      checked(await admin.auth.admin.deleteUser(temporaryUserId));
      temporaryUserId = null;
      return { deleted: true, deletedCount: 1 };
    },
    async uploadMedia(session, storagePath, media) {
      const result = await session.client.storage.from(settings.storageBucket).upload(storagePath, media, { contentType: settings.mimeType, upsert: false });
      const data = checked(result, "REAL_PIPELINE_HTTP_FAILED");
      if (data?.path !== storagePath) reject("REAL_PIPELINE_HTTP_FAILED");
      return { uploaded: true };
    },
    async removeMedia(storagePath) {
      const result = await admin.storage.from(settings.storageBucket).remove([storagePath]);
      checked(result, "REAL_PIPELINE_CLEANUP_FAILED");
      return { removed: true };
    },
    async mediaExists(storagePath) {
      const parts = storagePath.split("/");
      const name = parts.pop();
      if (!name || parts.length < 1) reject("REAL_PIPELINE_CLEANUP_FAILED");
      const result = await admin.storage.from(settings.storageBucket).list(parts.join("/"), { limit: 100, search: name });
      const data = checked(result, "REAL_PIPELINE_CLEANUP_FAILED");
      if (!Array.isArray(data)) reject("REAL_PIPELINE_CLEANUP_FAILED");
      return { exists: data.some((item) => item?.name === name) };
    },
    async cleanupSessionBundle(session, bundle) {
      if (!bundle || bundle.userId !== session.userId) reject("REAL_PIPELINE_CLEANUP_FAILED");
      const countSessionRows = async (table, idColumn = "session_id") => {
        const query = await admin.from(table).select(idColumn, { count: "exact", head: true }).eq(idColumn, bundle.sessionId).eq("user_id", session.userId);
        if (query.error || !Number.isSafeInteger(query.count) || query.count < 0) reject("REAL_PIPELINE_CLEANUP_FAILED");
        return query.count;
      };
      const sessionCount = await countSessionRows("practice_sessions", "id");
      if (sessionCount > 1) reject("REAL_PIPELINE_CLEANUP_FAILED");
      if (sessionCount === 1) {
        checked(await admin.from("practice_sessions").delete().eq("id", bundle.sessionId).eq("user_id", session.userId), "REAL_PIPELINE_CLEANUP_FAILED");
      }
      if (await countSessionRows("practice_sessions", "id") !== 0) reject("REAL_PIPELINE_CLEANUP_FAILED");
      for (const table of SESSION_DEPENDENT_TABLES) {
        if (await countSessionRows(table) !== 0) reject("REAL_PIPELINE_CLEANUP_FAILED");
      }
      checked(await admin.from("upload_intents").delete().eq("id", bundle.uploadIntentId).eq("session_id", bundle.sessionId).eq("user_id", session.userId), "REAL_PIPELINE_CLEANUP_FAILED");
      const remainingIntent = await admin.from("upload_intents").select("id", { count: "exact", head: true }).eq("id", bundle.uploadIntentId).eq("session_id", bundle.sessionId).eq("user_id", session.userId);
      if (remainingIntent.error || remainingIntent.count !== 0) reject("REAL_PIPELINE_CLEANUP_FAILED");
      const storage = await this.mediaExists(bundle.storagePath);
      if (storage.exists) await this.removeMedia(bundle.storagePath);
      const verified = await this.mediaExists(bundle.storagePath);
      if (verified.exists) reject("REAL_PIPELINE_CLEANUP_FAILED");
      return { absent: true };
    },
    async api(session, { method, path, body = null, headers = {} }) {
      if (!/^\/api\/v1\/[A-Za-z0-9_./-]+$/u.test(path) || !new Set(["GET", "POST", "DELETE"]).has(method)) reject("REAL_PIPELINE_HTTP_FAILED");
      const url = new URL(path, settings.platformOrigin);
      if (url.origin !== settings.platformOrigin || !["127.0.0.1", "::1", "localhost"].includes(url.hostname)) reject("REAL_PIPELINE_HTTP_FAILED");
      const requestHeaders = { accept: "application/json", cookie: session.cookieJar.header(), ...headers };
      let encoded;
      if (body !== null) {
        encoded = canonicalJson(body);
        if (Buffer.byteLength(encoded, "utf8") > MAX_HTTP_BYTES) reject("REAL_PIPELINE_HTTP_FAILED");
        requestHeaders["content-type"] = "application/json";
      }
      let response;
      try { response = await fetch(url, { method, headers: requestHeaders, body: encoded, redirect: "error", signal: AbortSignal.timeout(120_000) }); }
      catch { reject("REAL_PIPELINE_HTTP_FAILED"); }
      session.cookieJar.applySetCookie(response.headers);
      return { status: response.status, data: await readResponseBody(response) };
    },
  };
}

async function api(adapter, session, method, path, body, statuses, headers = {}) {
  return requireApiResult(await adapter.api(session, { method, path, body, headers }), statuses);
}

function emptyArtifact() {
  return { uploadIntentId: null, sessionId: null, storagePath: null, mediaUploaded: false, sessionCreateAttempted: false, pipelineCreated: false, planReceiptHmac: null, planCompleted: false };
}

async function createPreparedSession(adapter, primary, settings, media, artifact, cleanupChannel) {
  artifact.uploadIntentId = crypto.randomUUID();
  artifact.sessionId = crypto.randomUUID();
  artifact.storagePath = `users/${primary.userId}/practice-sessions/${artifact.sessionId}/take.${settings.mimeType === "video/quicktime" ? "mov" : "mp4"}`;
  artifact.planReceiptHmac = await planCleanup(cleanupChannel, "run-session-bundle", {
    uploadIntentId: artifact.uploadIntentId, sessionId: artifact.sessionId, storagePath: artifact.storagePath,
  }, ["retained", "deleted", "absent", "not_created"]);
  const intentResponse = await api(adapter, primary, "POST", "/api/v1/practice-upload-intents", {
    adultConfirmed: true,
    allParticipantsConfirmed: true,
    uploadIntentId: artifact.uploadIntentId,
    sessionId: artifact.sessionId,
    fileMetadata: { fileName: "protected-e2e-source.mp4", mimeType: settings.mimeType, sizeBytes: media.length },
  }, [201]);
  const intent = intentResponse.uploadIntent;
  if (!intent || typeof intent !== "object" || intent.storageBucket !== settings.storageBucket) reject();
  const uploadIntentId = requireUuid(intent.uploadIntentId);
  if (uploadIntentId !== artifact.uploadIntentId || requireUuid(intent.sessionId) !== artifact.sessionId || requireText(intent.storagePath, 2048) !== artifact.storagePath) reject();
  if (artifact.storagePath.startsWith("/") || artifact.storagePath.split("/").some((part) => !part || part === "." || part === "..")) reject();

  const uploaded = await adapter.uploadMedia(primary, artifact.storagePath, media);
  if (!uploaded || uploaded.uploaded !== true) reject("REAL_PIPELINE_HTTP_FAILED");
  artifact.mediaUploaded = true;
  const finalized = await api(adapter, primary, "POST", `/api/v1/practice-upload-intents/${uploadIntentId}/finalize`, { storagePath: artifact.storagePath }, [200]);
  if (finalized.uploadIntentId !== uploadIntentId || finalized.storagePath !== artifact.storagePath || finalized.mediaMetadataVersion !== "iso-bmff-duration.v1" || !Number.isSafeInteger(finalized.durationMs) || finalized.durationMs < 1 || finalized.durationMs > 300_000) reject();

  artifact.sessionCreateAttempted = true;
  const created = await api(adapter, primary, "POST", "/api/v1/practice-sessions", {
    sessionId: artifact.sessionId,
    uploadIntentId,
    storagePath: artifact.storagePath,
    ...SCENE_CONTEXT,
  }, [201]);
  artifact.pipelineCreated = true;
  if (!created.session || created.session.sessionId !== artifact.sessionId || !created.session.summary || !Array.isArray(created.session.observations) || created.session.observations.length < 1 || created.summaryRun?.stage !== "summary" || created.summaryRun?.status !== "completed") reject();
  return created;
}

async function deleteCreatedSession(adapter, primary, artifact) {
  if (!artifact.pipelineCreated || artifact.sessionId === null || artifact.storagePath === null || primary === null) reject("REAL_PIPELINE_CLEANUP_FAILED");
  const requestId = crypto.randomUUID();
  const deletion = await adapter.api(primary, {
    method: "DELETE",
    path: `/api/v1/practice-sessions/${artifact.sessionId}`,
    body: null,
    headers: { "Idempotency-Key": requestId },
  });
  if (!deletion || deletion.status !== 202 || deletion.data?.requestId !== requestId || deletion.data?.status !== "completed") reject("REAL_PIPELINE_CLEANUP_FAILED");
  const status = await adapter.api(primary, {
    method: "GET",
    path: `/api/v1/practice-sessions/${artifact.sessionId}/deletion/${requestId}`,
    body: null,
    headers: {},
  });
  if (!status || status.status !== 200 || status.data?.requestId !== requestId || status.data?.status !== "completed" || status.data?.storageDeleted !== true || status.data?.rowsDeleted !== true) reject("REAL_PIPELINE_CLEANUP_FAILED");
  const absent = await adapter.api(primary, { method: "GET", path: `/api/v1/practice-sessions/${artifact.sessionId}`, body: null, headers: {} });
  if (!absent || absent.status !== 404) reject("REAL_PIPELINE_CLEANUP_FAILED");
  const storage = await adapter.mediaExists(artifact.storagePath);
  if (!storage || storage.exists !== false) reject("REAL_PIPELINE_CLEANUP_FAILED");
  artifact.pipelineCreated = false;
  artifact.mediaUploaded = false;
}

async function cleanupArtifact(adapter, primary, artifact) {
  if (artifact.pipelineCreated) {
    await deleteCreatedSession(adapter, primary, artifact);
  }
  if (artifact.uploadIntentId !== null && artifact.sessionId !== null && artifact.storagePath !== null) {
    const cleaned = await adapter.cleanupSessionBundle(primary, { uploadIntentId: artifact.uploadIntentId, sessionId: artifact.sessionId, storagePath: artifact.storagePath, userId: primary.userId });
    if (!cleaned || cleaned.absent !== true) reject("REAL_PIPELINE_CLEANUP_FAILED");
    artifact.pipelineCreated = false;
    artifact.mediaUploaded = false;
    artifact.sessionCreateAttempted = false;
    return;
  }
  if (artifact.mediaUploaded && artifact.storagePath !== null) {
    const removed = await adapter.removeMedia(artifact.storagePath);
    if (!removed || removed.removed !== true) reject("REAL_PIPELINE_CLEANUP_FAILED");
    const storage = await adapter.mediaExists(artifact.storagePath);
    if (!storage || storage.exists !== false) reject("REAL_PIPELINE_CLEANUP_FAILED");
    artifact.mediaUploaded = false;
  }
}

export async function runRealPipeline({
  settingsFd = SETTINGS_FD,
  mediaFd = MEDIA_FD,
  macKeyFd = MAC_KEY_FD,
  receiptFd = RECEIPT_FD,
  handoffFd = null,
  handoffAckFd = null,
  cleanupFd = null,
  cleanupTimeoutMs = 30_000,
  adapterFactory = defaultAdapterFactory,
} = {}) {
  if (typeof adapterFactory !== "function" || cleanupFd === null) reject("REAL_PIPELINE_BAD_INPUT");
  validateEmptyReceiptFd(receiptFd);
  const key = readPrivateRegular(macKeyFd, 4096);
  if (key.length < 32) { key.fill(0); reject("REAL_PIPELINE_BAD_INPUT"); }
  let cleanupChannel;
  try { cleanupChannel = new CleanupChannel(cleanupFd, cleanupTimeoutMs); }
  catch (error) { key.fill(0); throw error; }
  let media = null;
  let adapter = null;
  let primary = null;
  let temporaryCreated = false;
  let temporaryDeleted = false;
  const mainArtifact = emptyArtifact();
  const deletionArtifact = emptyArtifact();
  let keepMain = false;
  let browserHandoffAcknowledged = false;
  let failure = null;
  let receipt = null;
  let receiptWritten = false;
  const temporaryEmail = `${TEMPORARY_EMAIL_PREFIX}${crypto.randomBytes(16).toString("hex")}@example.com`;
  let temporaryPlanReceiptHmac = null;
  let temporaryPlanCompleted = false;
  try {
    const settings = readSettings(settingsFd, key);
    const handoffRequested = settings.browserHandoff !== null;
    if ((handoffFd !== null) !== handoffRequested || (handoffAckFd !== null) !== handoffRequested) reject("REAL_PIPELINE_BAD_INPUT");
    media = readPrivateRegular(mediaFd, settings.maximumMediaBytes);
    const mediaHmac = hmacBytes(key, MEDIA_DOMAIN, media);
    if (!timingEqual(mediaHmac, settings.expectedMediaHmac)) reject("REAL_PIPELINE_BAD_INPUT");
    adapter = await adapterFactory(settings, { temporaryEmail });
    if (!adapter || typeof adapter !== "object") reject("REAL_PIPELINE_CONTRACT_FAILED");
    for (const method of ["establishExistingPrimary", "createTemporaryUserSession", "deleteTemporaryUser", "uploadMedia", "removeMedia", "mediaExists", "cleanupSessionBundle", "api"]) if (typeof adapter[method] !== "function") reject();

    primary = requireSession(await adapter.establishExistingPrimary());
    const accepted = await api(adapter, primary, "POST", "/api/v1/terms/acceptances", {
      requiredConsentAccepted: true,
      aiProcessingConsentAccepted: true,
      internalReviewConsent: false,
    }, [200]);
    if (accepted.accepted !== true || accepted.requiredConsentAccepted !== true || accepted.aiProcessingConsentAccepted !== true) reject();

    const created = await createPreparedSession(adapter, primary, settings, media, mainArtifact, cleanupChannel);
    let session = created.session;
    const mainSessionId = mainArtifact.sessionId;
    if (mainSessionId === null) reject();
    const observationId = requireUuid(session.observations[0].id);
    session = await api(adapter, primary, "POST", `/api/v1/practice-sessions/${mainSessionId}/observations/${observationId}/confirmation`, { state: "accepted" }, [200]);
    if (!session.observations?.some((item) => item.id === observationId && item.confirmationState === "accepted" && item.blockedForQuestioning === false)) reject();

    const started = await api(adapter, primary, "POST", `/api/v1/practice-sessions/${mainSessionId}/interview/start`, null, [200]);
    if (started.done === true || !started.agentTurn) reject();
    let terminal = null;
    let finalRequest = null;
    let finalResponse = null;
    for (let index = 0; index < SCENARIO_ANSWERS.length; index += 1) {
      const snapshot = await api(adapter, primary, "GET", `/api/v1/practice-sessions/${mainSessionId}`, null, [200]);
      session = snapshot.session;
      const progress = actorProgress(session);
      const request = {
        answer: SCENARIO_ANSWERS[index],
        requestId: crypto.randomUUID(),
        expectedSubstantiveAnswerCount: progress.substantive,
        expectedTotalConversationCount: progress.total,
      };
      const response = await api(adapter, primary, "POST", `/api/v1/practice-sessions/${mainSessionId}/interview/turns`, request, [200]);
      if (response.done === true) {
        if (index + 1 < 5 || response.reportReady !== true || !response.report || typeof response.completionReason !== "string" || !response.completionReason.endsWith("_report_ready")) reject();
        terminal = response;
        finalRequest = request;
        finalResponse = response;
        break;
      }
      if (!response.agentTurn || response.reportReady !== false) reject();
    }
    if (terminal === null || finalRequest === null || finalResponse === null) reject();

    const afterTerminal = await api(adapter, primary, "GET", `/api/v1/practice-sessions/${mainSessionId}`, null, [200]);
    session = afterTerminal.session;
    const progress = actorProgress(session);
    if (progress.substantive < 5 || progress.substantive > 10 || session.interviewStatus !== "completed" || !session.completionReason?.endsWith("_report_ready")) reject();
    const report = validateReport(await api(adapter, primary, "GET", `/api/v1/practice-sessions/${mainSessionId}/report`, null, [200]));
    if (report.sessionId !== mainSessionId) reject();
    const reportHmac = hmacJson(key, REPORT_DOMAIN, report);
    const browserBindingHmac = hmacJson(key, BROWSER_BINDING_DOMAIN, [mainSessionId, report.sourceRunId]);

    const replayed = await api(adapter, primary, "POST", `/api/v1/practice-sessions/${mainSessionId}/interview/turns`, finalRequest, [200]);
    if (hmacJson(key, REPORT_DOMAIN, replayed) !== hmacJson(key, REPORT_DOMAIN, finalResponse)) reject();
    const replaySnapshot = await api(adapter, primary, "GET", `/api/v1/practice-sessions/${mainSessionId}`, null, [200]);
    if (actorProgress(replaySnapshot.session).substantive !== progress.substantive) reject();
    const retryReport = validateReport(await api(adapter, primary, "POST", `/api/v1/practice-sessions/${mainSessionId}/report/retry`, null, [200]));
    const refreshedReport = validateReport(await api(adapter, primary, "GET", `/api/v1/practice-sessions/${mainSessionId}/report`, null, [200]));
    if (hmacJson(key, REPORT_DOMAIN, retryReport) !== reportHmac || hmacJson(key, REPORT_DOMAIN, refreshedReport) !== reportHmac) reject();
    const lineage = validateLineage(replaySnapshot.session, report);

    await createPreparedSession(adapter, primary, settings, media, deletionArtifact, cleanupChannel);
    await deleteCreatedSession(adapter, primary, deletionArtifact);
    await completeCleanup(cleanupChannel, "run-session-bundle", deletionArtifact.planReceiptHmac, "deleted");
    deletionArtifact.planCompleted = true;

    temporaryPlanReceiptHmac = await planCleanup(cleanupChannel, "temporary-rls-account", { email: temporaryEmail }, ["deleted", "absent", "not_created"]);
    temporaryCreated = true;
    const temporary = requireSession(await adapter.createTemporaryUserSession(temporaryEmail));
    const temporaryAcceptance = await api(adapter, temporary, "POST", "/api/v1/terms/acceptances", {
      requiredConsentAccepted: true,
      aiProcessingConsentAccepted: true,
      internalReviewConsent: false,
    }, [200]);
    if (temporaryAcceptance.accepted !== true) reject();
    const deniedSession = await adapter.api(temporary, { method: "GET", path: `/api/v1/practice-sessions/${mainSessionId}`, body: null, headers: {} });
    const deniedReport = await adapter.api(temporary, { method: "GET", path: `/api/v1/practice-sessions/${mainSessionId}/report`, body: null, headers: {} });
    const deniedDelete = await adapter.api(temporary, { method: "DELETE", path: `/api/v1/practice-sessions/${mainSessionId}`, body: null, headers: { "Idempotency-Key": crypto.randomUUID() } });
    if (![deniedSession, deniedReport, deniedDelete].every((result) => result?.status === 404)) reject();
    const ownerStillReads = await api(adapter, primary, "GET", `/api/v1/practice-sessions/${mainSessionId}`, null, [200]);
    if (ownerStillReads.session?.sessionId !== mainSessionId || hmacJson(key, REPORT_DOMAIN, ownerStillReads.session.report) !== reportHmac) reject();
    const deleted = await adapter.deleteTemporaryUser();
    if (!deleted || deleted.deleted !== true || !Number.isSafeInteger(deleted.deletedCount) || deleted.deletedCount !== 1) reject("REAL_PIPELINE_CLEANUP_FAILED");
    temporaryCreated = false;
    temporaryDeleted = true;
    await completeCleanup(cleanupChannel, "temporary-rls-account", temporaryPlanReceiptHmac, "deleted");
    temporaryPlanCompleted = true;

    if (handoffRequested) {
      const browser = settings.browserHandoff;
      if (browser === null || handoffFd === null || handoffAckFd === null) reject("REAL_PIPELINE_BAD_INPUT");
      const targetPath = `/practice/history/${mainSessionId}`;
      const handoff = {
        schemaVersion: HANDOFF_SCHEMA,
        supabaseUrl: settings.supabaseUrl,
        publishableKey: settings.publishableKey,
        accessToken: primary.accessToken,
        refreshToken: primary.refreshToken,
        nonce: browser.nonce,
        brokerPort: browser.brokerPort,
        targetPort: browser.targetPort,
        targetPath,
        developmentTargetHmac: settings.developmentTargetHmac,
      };
      try { writePrivateJson(handoffFd, handoff, { streamOnly: true }); }
      finally { handoff.accessToken = ""; handoff.refreshToken = ""; }
      validateHandoffAck(await readPrivateStreamJson(handoffAckFd), key, {
        nonce: browser.nonce,
        targetPort: browser.targetPort,
        targetPath,
        developmentTargetHmac: settings.developmentTargetHmac,
      });
      browserHandoffAcknowledged = true;
      primary.accessToken = "";
      primary.refreshToken = "";
    }

    const safeCore = {
      schemaVersion: RECEIPT_SCHEMA,
      completed: true,
      mainSessionCount: 1,
      substantiveAnswerCount: progress.substantive,
      reportSectionCount: REPORT_SECTION_KEYS.length,
      acceptedObservationCount: lineage.acceptedObservationIds.length,
      crossUserDenied: true,
      crossUserDeniedOperationCount: 3,
      replayVerified: true,
      immutableReportVerified: true,
      browserHandoffAcknowledged,
      deletionLifecycleVerified: true,
      temporaryUserDeleted: true,
      mediaByteCount: media.length,
      mediaHmac,
      lineageHmac: hmacJson(key, LINEAGE_DOMAIN, lineage),
      reportHmac,
      browserBindingHmac,
    };
    receipt = validateReceipt({ ...safeCore, resultHmac: hmacJson(key, RECEIPT_DOMAIN, safeCore) });
    writePrivateJson(receiptFd, receipt);
    receiptWritten = true;
    keepMain = true;
  } catch (error) {
    failure = error instanceof RealPipelineFailure ? error : new RealPipelineFailure();
  } finally {
    if (adapter !== null && temporaryCreated) {
      try {
        const deleted = await adapter.deleteTemporaryUser();
        if (!deleted || deleted.deleted !== true) throw new Error("cleanup");
        temporaryDeleted = true;
        if (temporaryPlanReceiptHmac !== null && !temporaryPlanCompleted) {
          await completeCleanup(cleanupChannel, "temporary-rls-account", temporaryPlanReceiptHmac, deleted.deletedCount === 0 ? "absent" : "deleted");
          temporaryPlanCompleted = true;
        }
      } catch { if (failure === null) failure = new RealPipelineFailure("REAL_PIPELINE_CLEANUP_FAILED"); }
    }
    if (adapter !== null) {
      for (const artifact of [deletionArtifact, ...(keepMain ? [] : [mainArtifact])]) {
        if (artifact.planReceiptHmac === null || artifact.planCompleted) continue;
        try {
          await cleanupArtifact(adapter, primary, artifact);
          if (artifact.planReceiptHmac !== null && !artifact.planCompleted) {
            await completeCleanup(cleanupChannel, "run-session-bundle", artifact.planReceiptHmac, artifact.pipelineCreated || artifact.mediaUploaded ? "deleted" : "absent");
            artifact.planCompleted = true;
          }
        }
        catch { failure = new RealPipelineFailure("REAL_PIPELINE_CLEANUP_FAILED"); }
      }
    }
    if (failure !== null && receiptWritten && !keepMain && !clearPrivateReceipt(receiptFd)) {
      failure = new RealPipelineFailure("REAL_PIPELINE_CLEANUP_FAILED");
    }
    if (media !== null) media.fill(0);
    if (primary !== null) { primary.accessToken = ""; primary.refreshToken = ""; }
    key.fill(0);
    cleanupChannel.close();
  }
  if (failure !== null) throw failure;
  if (!temporaryDeleted || receipt === null) reject("REAL_PIPELINE_CLEANUP_FAILED");
  return receipt;
}

function clearInheritedEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!new Set(["PATH", "LANG", "LC_ALL", "TZ"]).has(key)) delete process.env[key];
  }
}

function directStreamFd(fd) {
  return writablePrivateFd(fd, { optional: true, streamOnly: true }) === null ? null : fd;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly && process.argv.length === 2) {
  process.exitCode = 0;
} else if (invokedDirectly) {
  if (process.argv.length !== 3 || process.argv[2] !== "--live") {
    process.exitCode = 70;
  } else {
    clearInheritedEnvironment();
    const executeDirect = async () => {
      try {
        const handoffFd = directStreamFd(HANDOFF_FD);
        const handoffAckFd = directStreamFd(HANDOFF_ACK_FD);
        await runRealPipeline({ handoffFd, handoffAckFd, cleanupFd: directStreamFd(CLEANUP_FD) });
        return 0;
      } catch (error) {
        const safeCode = error instanceof RealPipelineFailure ? error.safeCode : "REAL_PIPELINE_CONTRACT_FAILED";
        try { writePrivateJson(RECEIPT_FD, { safeCode }); } catch { /* fixed silent exit */ }
        return 70;
      }
    };
    executeDirect().then((status) => { process.exitCode = status; });
  }
}
