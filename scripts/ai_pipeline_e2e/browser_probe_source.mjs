import crypto from "node:crypto";
import fs from "node:fs";

const MAX_KEY_BYTES = 4096;
const HMAC_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RECEIPT_DOMAIN = Buffer.from("acttub-protected-browser-result.v1\0", "ascii");
const BINDING_DOMAIN = Buffer.from("acttub-browser-binding.v1\0", "ascii");
const PROBE_SUBKEY_DOMAIN = Buffer.from("acttub-protected-browser-probe-subkey.v1\0", "ascii");

export const SELECTORS = Object.freeze({
  reportRoot: '[data-testid="pipeline-report"]',
  reportSection: '[data-testid="pipeline-report-section"]',
  seekControl: '[data-testid="pipeline-report-seek"]',
  privateVideo: '[data-testid="pipeline-private-video"]',
});

export const OBSERVE_SOURCE = String.raw`async (macKeyHex) => {
  if (!/^[a-f0-9]{64}$/.test(macKeyHex)) throw new Error("probe");
  const selectors = {
    reportRoot: '[data-testid="pipeline-report"]',
    reportSection: '[data-testid="pipeline-report-section"]',
    seekControl: '[data-testid="pipeline-report-seek"]',
  };
  const roots = Array.from(document.querySelectorAll(selectors.reportRoot));
  const rootCount = roots.length;
  const sections = Array.from(document.querySelectorAll(selectors.reportSection));
  const seekControls = Array.from(document.querySelectorAll(selectors.seekControl));
  const confirmedCount = sections.filter((item) => item.getAttribute("data-report-status") === "confirmed").length;
  const notConfirmedCount = sections.filter((item) => item.getAttribute("data-report-status") === "not_confirmed").length;
  const targetValue = seekControls[0]?.getAttribute("data-seek-start-ms") ?? "";
  const seekTargetMs = /^[0-9]{1,9}$/.test(targetValue) ? Number(targetValue) : -1;
  const stableContent = sections.map((item) => [
    item.getAttribute("data-report-section") ?? "",
    item.getAttribute("data-report-status") ?? "",
    item.textContent ?? "",
  ]);
  const root = roots[0] ?? null;
  const sessionId = root?.getAttribute("data-report-session-id") ?? "";
  const sourceRunId = root?.getAttribute("data-report-source-run-id") ?? "";
  const keyBytes = Uint8Array.from(macKeyHex.match(/.{2}/g), (value) => Number.parseInt(value, 16));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  keyBytes.fill(0);
  const mac = async (domain, value) => {
    const encoded = new TextEncoder().encode(domain + "\0" + JSON.stringify(value));
    const signature = await crypto.subtle.sign("HMAC", key, encoded);
    encoded.fill(0);
    return "hmac-sha256:" + Array.from(new Uint8Array(signature), (item) => item.toString(16).padStart(2, "0")).join("");
  };
  const contentHmac = await mac("acttub-browser-content.v1", stableContent);
  const bindingHmac = await mac("acttub-browser-binding.v1", [sessionId, sourceRunId]);
  return {
    schemaVersion: "protected-browser-observation.v1",
    reportRootCount: rootCount,
    reportSectionCount: sections.length,
    confirmedCount,
    notConfirmedCount,
    timestampSeekControlCount: seekControls.length,
    seekTargetMs,
    contentHmac,
    bindingHmac,
  };
}`;

export const ACTIVATE_SEEK_SOURCE = String.raw`() => {
  const controls = document.querySelectorAll('[data-testid="pipeline-report-seek"]');
  if (controls.length < 1) return { schemaVersion: "protected-browser-action.v1", activated: false };
  controls[0].click();
  return { schemaVersion: "protected-browser-action.v1", activated: true };
}`;

export const VIDEO_TIME_SOURCE = String.raw`() => {
  const video = document.querySelector('[data-testid="pipeline-private-video"]');
  const currentTimeMs = video && Number.isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : -1;
  return {
    schemaVersion: "protected-browser-video-time.v1",
    available: currentTimeMs >= 0,
    currentTimeMs,
  };
}`;

export const BINDING_IDENTIFIERS_SOURCE = String.raw`() => {
  const roots = document.querySelectorAll('[data-testid="pipeline-report"]');
  const root = roots.length === 1 ? roots[0] : null;
  return {
    schemaVersion: "protected-browser-binding-identifiers.v1",
    sessionId: root?.getAttribute("data-report-session-id") ?? "",
    sourceRunId: root?.getAttribute("data-report-source-run-id") ?? "",
  };
}`;

class ProbeFailure extends Error {
  constructor() {
    super("BROWSER_PROBE_FAILED");
    this.name = "ProbeFailure";
  }
}

function reject() {
  throw new ProbeFailure();
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject();
  return value;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && !value.includes("\0")) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  reject();
}

function timingSafeAscii(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const first = Buffer.from(left, "ascii");
  const second = Buffer.from(right, "ascii");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function probeKeyContext(value) {
  const item = exactObject(value, [
    "schemaVersion",
    "developmentTargetHmac",
    "browserTargetHmac",
    "expectedBindingHmac",
  ]);
  if (
    item.schemaVersion !== "protected-browser-probe-key-context.v1" ||
    !HMAC_PATTERN.test(item.developmentTargetHmac) ||
    !HMAC_PATTERN.test(item.browserTargetHmac) ||
    !HMAC_PATTERN.test(item.expectedBindingHmac)
  ) reject();
  return item;
}

export function deriveBrowserProbeKey(masterKey, context) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length < 32 || masterKey.length > MAX_KEY_BYTES) reject();
  const item = probeKeyContext(context);
  const semantic = [item.developmentTargetHmac, item.browserTargetHmac, item.expectedBindingHmac];
  return crypto.createHmac("sha256", masterKey).update(PROBE_SUBKEY_DOMAIN).update(canonicalJson(semantic), "ascii").digest();
}

function bindingIdentifiers(value) {
  const item = exactObject(value, ["schemaVersion", "sessionId", "sourceRunId"]);
  if (
    item.schemaVersion !== "protected-browser-binding-identifiers.v1" ||
    !UUID_PATTERN.test(item.sessionId) ||
    !UUID_PATTERN.test(item.sourceRunId)
  ) reject();
  return item;
}

function bindingHmac(key, identifiers) {
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(BINDING_DOMAIN).update(canonicalJson([identifiers.sessionId, identifiers.sourceRunId]), "ascii").digest("hex")}`;
}

function readKey(fd) {
  if (!Number.isInteger(fd) || fd <= 2) reject();
  let info;
  try {
    info = fs.fstatSync(fd);
  } catch {
    reject();
  }
  if (!(info.isFile() || info.isFIFO())) reject();
  if (
    info.isFile() &&
    ((typeof process.geteuid === "function" && info.uid !== process.geteuid()) || (info.mode & 0o077) !== 0 || info.size < 16 || info.size > MAX_KEY_BYTES)
  ) reject();
  const chunks = [];
  let total = 0;
  while (total <= MAX_KEY_BYTES) {
    const chunk = Buffer.alloc(Math.min(4096, MAX_KEY_BYTES + 1 - total));
    let count;
    try {
      count = fs.readSync(fd, chunk, 0, chunk.length, info.isFile() ? total : null);
    } catch {
      reject();
    }
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    total += count;
  }
  if (total < 16 || total > MAX_KEY_BYTES) reject();
  return Buffer.concat(chunks, total);
}

function observation(value) {
  const item = exactObject(value, [
    "schemaVersion",
    "reportRootCount",
    "reportSectionCount",
    "confirmedCount",
    "notConfirmedCount",
    "timestampSeekControlCount",
    "seekTargetMs",
    "contentHmac",
    "bindingHmac",
  ]);
  if (
    item.schemaVersion !== "protected-browser-observation.v1" ||
    !HMAC_PATTERN.test(item.contentHmac) ||
    !HMAC_PATTERN.test(item.bindingHmac)
  ) reject();
  for (const key of ["reportRootCount", "reportSectionCount", "confirmedCount", "notConfirmedCount", "timestampSeekControlCount"]) {
    if (!Number.isSafeInteger(item[key]) || item[key] < 0 || item[key] > 64) reject();
  }
  if (!Number.isSafeInteger(item.seekTargetMs) || item.seekTargetMs < -1 || item.seekTargetMs > 300_000) reject();
  return item;
}

function action(value) {
  const item = exactObject(value, ["schemaVersion", "activated"]);
  if (item.schemaVersion !== "protected-browser-action.v1" || typeof item.activated !== "boolean") reject();
  return item;
}

function videoTime(value) {
  const item = exactObject(value, ["schemaVersion", "available", "currentTimeMs"]);
  if (
    item.schemaVersion !== "protected-browser-video-time.v1" ||
    typeof item.available !== "boolean" ||
    !Number.isSafeInteger(item.currentTimeMs) ||
    item.currentTimeMs < -1 || item.currentTimeMs > 300_000 ||
    item.available !== (item.currentTimeMs >= 0)
  ) reject();
  return item;
}

function validateAttestation(value) {
  const item = exactObject(value, [
    "schemaVersion",
    "operation",
    "resultHmac",
    "success",
    "booleanCount",
    "boundedCount",
    "capturedArtifacts",
  ]);
  if (
    item.schemaVersion !== "protected-browser-attestation.v1" ||
    item.operation !== "ui_probe" ||
    typeof item.resultHmac !== "string" || !HMAC_PATTERN.test(item.resultHmac) ||
    item.success !== true ||
    item.booleanCount !== 3 ||
    item.boundedCount !== 2 ||
    item.capturedArtifacts !== 0
  ) reject();
  return item;
}

export function createBrowserAttestation({
  before,
  after,
  seekAction,
  video,
  binding,
  expectedBindingHmac,
  probeContext,
  macKeyFd,
}) {
  const first = observation(before);
  const second = observation(after);
  const activated = action(seekAction);
  const videoResult = videoTime(video);
  const identifiers = bindingIdentifiers(binding);
  const context = probeKeyContext(probeContext);
  if (!timingSafeAscii(context.expectedBindingHmac, expectedBindingHmac)) reject();
  const key = readKey(macKeyFd);
  let probeKey = null;
  try {
    probeKey = deriveBrowserProbeKey(key, context);
    const expectedMasterBinding = bindingHmac(key, identifiers);
    const expectedProbeBinding = bindingHmac(probeKey, identifiers);
    if (
      !timingSafeAscii(expectedMasterBinding, expectedBindingHmac) ||
      !timingSafeAscii(first.bindingHmac, expectedProbeBinding) ||
      !timingSafeAscii(second.bindingHmac, expectedProbeBinding)
    ) reject();
    const confirmedAndNotConfirmedRendered =
      first.reportRootCount === 1 &&
      second.reportRootCount === 1 &&
      first.reportSectionCount === 6 &&
      second.reportSectionCount === 6 &&
      first.confirmedCount > 0 &&
      first.notConfirmedCount > 0 &&
      second.confirmedCount === first.confirmedCount &&
      second.notConfirmedCount === first.notConfirmedCount &&
      first.confirmedCount + first.notConfirmedCount === 6;
    const timestampSeekVerified =
      activated.activated === true &&
      videoResult.available === true &&
      first.timestampSeekControlCount > 0 &&
      first.seekTargetMs >= 0 &&
      Math.abs(videoResult.currentTimeMs - first.seekTargetMs) <= 1500;
    const refreshResultStable =
      second.contentHmac === first.contentHmac &&
      second.bindingHmac === first.bindingHmac &&
      second.timestampSeekControlCount === first.timestampSeekControlCount &&
      second.seekTargetMs === first.seekTargetMs;
    if (
      !HMAC_PATTERN.test(expectedBindingHmac) ||
      !confirmedAndNotConfirmedRendered ||
      !timestampSeekVerified ||
      !refreshResultStable
    ) reject();

    const semanticResult = {
      reportSectionCount: first.reportSectionCount,
      capturedVisualArtifactCount: 0,
      confirmedAndNotConfirmedRendered,
      timestampSeekVerified,
      refreshResultStable,
      beforeContentHmac: first.contentHmac,
      afterContentHmac: second.contentHmac,
      bindingHmac: first.bindingHmac,
      seekTargetMs: first.seekTargetMs,
      observedVideoTimeMs: videoResult.currentTimeMs,
    };
    const resultHmac = `hmac-sha256:${crypto.createHmac("sha256", key).update(RECEIPT_DOMAIN).update(canonicalJson(semanticResult), "ascii").digest("hex")}`;
    return validateAttestation({
      schemaVersion: "protected-browser-attestation.v1",
      operation: "ui_probe",
      resultHmac,
      success: true,
      booleanCount: 3,
      boundedCount: 2,
      capturedArtifacts: 0,
    });
  } finally {
    if (probeKey !== null) probeKey.fill(0);
    key.fill(0);
  }
}

export function writeBrowserAttestation(outputFd, value) {
  const attestation = validateAttestation(value);
  if (!Number.isInteger(outputFd) || outputFd <= 2) reject();
  let info;
  try {
    info = fs.fstatSync(outputFd);
  } catch {
    reject();
  }
  const privateRegular =
    info.isFile() &&
    (!process.geteuid || info.uid === process.geteuid()) &&
    (info.mode & 0o077) === 0 &&
    (info.nlink === 0 || info.nlink === 1);
  if (!(info.isFIFO() || privateRegular)) reject();
  const encoded = Buffer.from(`${canonicalJson(attestation)}\n`, "ascii");
  try {
    if (info.isFile()) fs.ftruncateSync(outputFd, 0);
    let offset = 0;
    while (offset < encoded.length) {
      const count = fs.writeSync(outputFd, encoded, offset, encoded.length - offset, info.isFile() ? offset : null);
      if (count <= 0) reject();
      offset += count;
    }
    if (info.isFile()) fs.fsyncSync(outputFd);
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    reject();
  }
}
