import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";

import {
  ACTIVATE_SEEK_SOURCE,
  BINDING_IDENTIFIERS_SOURCE,
  OBSERVE_SOURCE,
  SELECTORS,
  VIDEO_TIME_SOURCE,
  createBrowserAttestation,
  deriveBrowserProbeKey,
  writeBrowserAttestation,
} from "./browser_probe_source.mjs";
import { projectRefHmac } from "./development_target.mjs";

const SETTINGS_FD = 3;
const MAC_KEY_FD = 4;
const RECEIPT_FD = 5;
const BINDING_EXPECTATION_FD = 6;
const SETTINGS_SCHEMA = "protected-browser-runner-settings.v1";
const LOOPBACK_HOST = "127.0.0.1";
const MAX_SETTINGS_BYTES = 16 * 1024;
const MAX_KEY_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 30_000;
const HMAC_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const TARGET_BINDING_DOMAIN = Buffer.from("acttub-protected-browser-target.v1\0", "ascii");

export const TARGET_ASSERTION_SOURCE = String.raw`(targetPort) => {
  const expectedPath = /^\/practice\/history\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return location.protocol === "http:" &&
    location.hostname === "127.0.0.1" &&
    location.port === String(targetPort) &&
    location.username === "" &&
    location.password === "" &&
    location.search === "" &&
    location.hash === "" &&
    expectedPath.test(location.pathname);
}`;

export class BrowserRunnerFailure extends Error {
  constructor() {
    super("BROWSER_PROBE_RUNNER_FAILED");
    this.name = "BrowserRunnerFailure";
    this.safeCode = "BROWSER_PROBE_RUNNER_FAILED";
  }
}

function reject() {
  throw new BrowserRunnerFailure();
}

function timingSafeAscii(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const first = Buffer.from(left, "ascii");
  const second = Buffer.from(right, "ascii");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function canonicalJson(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && !value.includes("\0")) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  reject();
}

function targetBindingHmac(key, settings) {
  let expectedDevelopmentTarget;
  try {
    expectedDevelopmentTarget = projectRefHmac(key, settings.developmentProjectRef);
  } catch {
    reject();
  }
  if (!timingSafeAscii(expectedDevelopmentTarget, settings.developmentTargetHmac)) reject();
  const semantic = [
    settings.developmentTargetHmac,
    settings.brokerPort,
    settings.targetPort,
    settings.nonce,
  ];
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(TARGET_BINDING_DOMAIN).update(canonicalJson(semantic), "ascii").digest("hex")}`;
}

function privateRegularInfo(fd, { maximum, allowEmpty = false }) {
  if (!Number.isInteger(fd) || fd <= 2 || !Number.isSafeInteger(maximum) || maximum < 1) reject();
  let info;
  try {
    info = fs.fstatSync(fd);
  } catch {
    reject();
  }
  const owned = typeof process.geteuid !== "function" || info.uid === process.geteuid();
  if (
    !info.isFile() ||
    !owned ||
    (info.mode & 0o077) !== 0 ||
    (info.nlink !== 0 && info.nlink !== 1) ||
    info.size > maximum ||
    (!allowEmpty && info.size < 1)
  ) reject();
  return info;
}

function readPrivateRegular(fd, maximum) {
  const info = privateRegularInfo(fd, { maximum });
  const output = Buffer.alloc(info.size);
  let offset = 0;
  try {
    while (offset < output.length) {
      const count = fs.readSync(fd, output, offset, output.length - offset, offset);
      if (count <= 0) reject();
      offset += count;
    }
  } catch (error) {
    output.fill(0);
    if (error instanceof BrowserRunnerFailure) throw error;
    reject();
  }
  return output;
}

function parseFlatUniqueJson(input) {
  if (!Buffer.isBuffer(input) || input.length < 2 || input.length > MAX_SETTINGS_BYTES) reject();
  const source = input.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(input)) reject();
  let cursor = 0;
  const whitespace = () => {
    while (
      source[cursor] === " " ||
      source[cursor] === "\n" ||
      source[cursor] === "\r" ||
      source[cursor] === "\t"
    ) cursor += 1;
  };
  const stringValue = () => {
    if (source[cursor] !== '"') reject();
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code < 0x20) reject();
      if (source[cursor] === '"') {
        cursor += 1;
        let parsed;
        try { parsed = JSON.parse(source.slice(start, cursor)); } catch { reject(); }
        if (typeof parsed !== "string" || parsed.includes("\0") || Buffer.byteLength(parsed, "utf8") > 4096) reject();
        return parsed;
      }
      if (source[cursor] === "\\") {
        cursor += 1;
        if (cursor >= source.length || !'"\\/bfnrtu'.includes(source[cursor])) reject();
        if (source[cursor] === "u") {
          if (!/^[a-fA-F0-9]{4}$/u.test(source.slice(cursor + 1, cursor + 5))) reject();
          cursor += 4;
        }
      }
      cursor += 1;
    }
    reject();
  };
  const integerValue = () => {
    const match = source.slice(cursor).match(/^(?:0|[1-9][0-9]*)/u);
    if (match === null) reject();
    cursor += match[0].length;
    const parsed = Number(match[0]);
    if (!Number.isSafeInteger(parsed)) reject();
    return parsed;
  };

  whitespace();
  if (source[cursor] !== "{") reject();
  cursor += 1;
  const result = Object.create(null);
  const keys = new Set();
  whitespace();
  if (source[cursor] === "}") reject();
  while (cursor < source.length) {
    whitespace();
    const key = stringValue();
    if (keys.has(key) || keys.size >= 16) reject();
    keys.add(key);
    whitespace();
    if (source[cursor] !== ":") reject();
    cursor += 1;
    whitespace();
    result[key] = source[cursor] === '"' ? stringValue() : integerValue();
    whitespace();
    if (source[cursor] === "}") {
      cursor += 1;
      break;
    }
    if (source[cursor] !== ",") reject();
    cursor += 1;
  }
  whitespace();
  if (cursor !== source.length) reject();
  return result;
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject();
  return value;
}

function readSettings(fd, key) {
  const raw = readPrivateRegular(fd, MAX_SETTINGS_BYTES);
  let item;
  try {
    item = exactObject(parseFlatUniqueJson(raw), [
      "schemaVersion",
      "developmentProjectRef",
      "developmentTargetHmac",
      "browserTargetHmac",
      "nonce",
      "brokerPort",
      "targetPort",
    ]);
  } finally {
    raw.fill(0);
  }
  if (
    item.schemaVersion !== SETTINGS_SCHEMA ||
    !PROJECT_REF_PATTERN.test(item.developmentProjectRef) ||
    !HMAC_PATTERN.test(item.developmentTargetHmac) ||
    !HMAC_PATTERN.test(item.browserTargetHmac) ||
    !NONCE_PATTERN.test(item.nonce)
  ) reject();
  for (const port of [item.brokerPort, item.targetPort]) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) reject();
  }
  if (item.brokerPort === item.targetPort) reject();
  const expectedTarget = targetBindingHmac(key, item);
  if (!timingSafeAscii(expectedTarget, item.browserTargetHmac)) reject();
  return item;
}

function parseBindingExpectation(raw) {
  let item;
  try {
    item = exactObject(parseFlatUniqueJson(raw), ["schemaVersion", "expectedBindingHmac"]);
  } finally {
    raw.fill(0);
  }
  if (
    item.schemaVersion !== "protected-browser-binding-expectation.v1" ||
    !HMAC_PATTERN.test(item.expectedBindingHmac)
  ) reject();
  return item.expectedBindingHmac;
}

function readBindingStream(fd, info, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stream;
    let settled = false;
    const chunks = [];
    let total = 0;
    const finish = (error = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners();
      if (error || total < 2 || total > MAX_SETTINGS_BYTES) {
        for (const chunk of chunks) chunk.fill(0);
        rejectPromise(new BrowserRunnerFailure());
        return;
      }
      const result = Buffer.concat(chunks, total);
      for (const chunk of chunks) chunk.fill(0);
      resolvePromise(result);
    };
    try {
      stream = info.isSocket()
        ? new net.Socket({ fd, readable: true, writable: false })
        : fs.createReadStream("", { fd, autoClose: false });
    } catch {
      rejectPromise(new BrowserRunnerFailure());
      return;
    }
    const timer = setTimeout(() => {
      try { stream.destroy(); } catch { /* fixed failure below */ }
      finish(true);
    }, timeoutMs);
    stream.on("data", (chunk) => {
      if (!Buffer.isBuffer(chunk) || total + chunk.length > MAX_SETTINGS_BYTES) {
        try { stream.destroy(); } catch { /* fixed failure below */ }
        finish(true);
        return;
      }
      chunks.push(Buffer.from(chunk));
      total += chunk.length;
    });
    stream.once("end", () => finish(false));
    stream.once("error", () => finish(true));
  });
}

async function readBindingExpectation(fd, timeoutMs) {
  if (!Number.isInteger(fd) || fd <= 2) reject();
  let info;
  try { info = fs.fstatSync(fd); } catch { reject(); }
  let raw;
  if (info.isFile()) {
    raw = readPrivateRegular(fd, MAX_SETTINGS_BYTES);
  } else {
    if (!(info.isSocket() || info.isFIFO())) reject();
    raw = await readBindingStream(fd, info, timeoutMs);
  }
  return parseBindingExpectation(raw);
}

async function defaultDependencyLoader() {
  for (const specifier of ["playwright", "@playwright/test"]) {
    try {
      const loaded = await import(specifier);
      if (loaded?.chromium && typeof loaded.chromium.launch === "function") return { chromium: loaded.chromium };
    } catch {
      // The fixed failure below is the only public result.
    }
  }
  reject();
}

function dependencies(value) {
  const item = exactObject(value, ["chromium"]);
  if (!item.chromium || typeof item.chromium.launch !== "function") reject();
  return item;
}

function withTimeout(value, timeoutMs) {
  return new Promise((resolve, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new BrowserRunnerFailure()), timeoutMs);
    Promise.resolve(value).then(
      (result) => { clearTimeout(timer); resolve(result); },
      () => { clearTimeout(timer); rejectPromise(new BrowserRunnerFailure()); },
    );
  });
}

function requestClass(rawTarget, settings, handoffOpen) {
  let target;
  try { target = new URL(rawTarget); } catch { return false; }
  if (target.username || target.password) return false;
  if (target.protocol === "http:" && target.hostname === LOOPBACK_HOST) {
    const port = Number(target.port);
    if (port === settings.targetPort) return "target";
    if (
      handoffOpen &&
      port === settings.brokerPort &&
      target.pathname === `/__acttub_session/${settings.nonce}` &&
      target.search === "" &&
      target.hash === ""
    ) return "broker";
    return false;
  }
  return (
    target.protocol === "https:" &&
    target.hostname === `${settings.developmentProjectRef}.supabase.co` &&
    target.port === ""
  ) ? "development" : false;
}

async function requirePageReady(page, timeoutMs) {
  await withTimeout(page.waitForSelector(SELECTORS.reportRoot, { state: "attached", timeout: timeoutMs }), timeoutMs);
  await withTimeout(page.waitForSelector(SELECTORS.privateVideo, { state: "attached", timeout: timeoutMs }), timeoutMs);
}

export async function runProtectedBrowserProbe({
  settingsFd = SETTINGS_FD,
  macKeyFd = MAC_KEY_FD,
  receiptFd = RECEIPT_FD,
  bindingExpectationFd = BINDING_EXPECTATION_FD,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dependencyLoader = defaultDependencyLoader,
} = {}) {
  if (
    typeof dependencyLoader !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) reject();
  if (new Set([settingsFd, macKeyFd, receiptFd, bindingExpectationFd]).size !== 4) reject();
  const receiptInfo = privateRegularInfo(receiptFd, { maximum: MAX_SETTINGS_BYTES, allowEmpty: true });
  if ((receiptInfo.mode & 0o777) !== 0o600) reject();
  const key = readPrivateRegular(macKeyFd, MAX_KEY_BYTES);
  if (key.length < 32) {
    key.fill(0);
    reject();
  }
  let settings;
  let browser = null;
  let context = null;
  let attestation = null;
  let failure = null;
  let probeKey = null;
  let probeKeyHex = "";
  let binding = null;
  let probeContext = null;
  let expectedBindingHmac = "";
  let blockedRequest = false;
  let handoffRequestUsed = false;
  try {
    settings = readSettings(settingsFd, key);
    const { chromium } = dependencies(await withTimeout(dependencyLoader(), timeoutMs));
    browser = await withTimeout(chromium.launch({ headless: true, timeout: timeoutMs }), timeoutMs);
    if (!browser || typeof browser.newContext !== "function" || typeof browser.close !== "function") reject();
    context = await withTimeout(browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
    }), timeoutMs);
    if (
      !context ||
      typeof context.route !== "function" ||
      typeof context.routeWebSocket !== "function" ||
      typeof context.newPage !== "function" ||
      typeof context.pages !== "function" ||
      typeof context.close !== "function"
    ) reject();

    let handoffOpen = true;
    await withTimeout(context.route("**/*", async (route) => {
      let classification = false;
      let request = null;
      try {
        request = route.request();
        classification = request && typeof request.url === "function"
          ? requestClass(request.url(), settings, handoffOpen)
          : false;
      } catch {
        classification = false;
      }
      if (classification === "broker") {
        const validBrokerRequest =
          !handoffRequestUsed &&
          typeof request?.method === "function" &&
          request.method() === "GET" &&
          typeof request?.isNavigationRequest === "function" &&
          request.isNavigationRequest() === true;
        if (validBrokerRequest) handoffRequestUsed = true;
        else classification = false;
      }
      if (classification === false) {
        blockedRequest = true;
        try { await route.abort("blockedbyclient"); } catch { /* fixed failure below */ }
        return;
      }
      try { await route.continue(); } catch { blockedRequest = true; }
    }), timeoutMs);
    await withTimeout(context.routeWebSocket("**/*", async (websocket) => {
      blockedRequest = true;
      try { await websocket.close({ code: 1008, reason: "blocked" }); } catch { /* fixed failure below */ }
    }), timeoutMs);

    const page = await withTimeout(context.newPage(), timeoutMs);
    if (
      !page ||
      typeof page.goto !== "function" ||
      typeof page.reload !== "function" ||
      typeof page.waitForSelector !== "function" ||
      typeof page.evaluate !== "function"
    ) reject();
    const handoffTarget = `http://${LOOPBACK_HOST}:${settings.brokerPort}/__acttub_session/${settings.nonce}`;
    await withTimeout(page.goto(handoffTarget, { waitUntil: "domcontentloaded", timeout: timeoutMs }), timeoutMs);
    handoffOpen = false;
    const targetAccepted = await withTimeout(page.evaluate(TARGET_ASSERTION_SOURCE, settings.targetPort), timeoutMs);
    if (targetAccepted !== true || !handoffRequestUsed || blockedRequest) reject();
    expectedBindingHmac = await readBindingExpectation(bindingExpectationFd, timeoutMs);
    await requirePageReady(page, timeoutMs);

    binding = await withTimeout(page.evaluate(BINDING_IDENTIFIERS_SOURCE), timeoutMs);
    probeContext = {
      schemaVersion: "protected-browser-probe-key-context.v1",
      developmentTargetHmac: settings.developmentTargetHmac,
      browserTargetHmac: settings.browserTargetHmac,
      expectedBindingHmac,
    };
    probeKey = deriveBrowserProbeKey(key, probeContext);
    probeKeyHex = probeKey.toString("hex");
    const before = await withTimeout(page.evaluate(OBSERVE_SOURCE, probeKeyHex), timeoutMs);
    await withTimeout(page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs }), timeoutMs);
    const reloadTargetAccepted = await withTimeout(page.evaluate(TARGET_ASSERTION_SOURCE, settings.targetPort), timeoutMs);
    if (reloadTargetAccepted !== true || blockedRequest) reject();
    await requirePageReady(page, timeoutMs);
    const after = await withTimeout(page.evaluate(OBSERVE_SOURCE, probeKeyHex), timeoutMs);
    const seekAction = await withTimeout(page.evaluate(ACTIVATE_SEEK_SOURCE), timeoutMs);
    const video = await withTimeout(page.evaluate(VIDEO_TIME_SOURCE), timeoutMs);
    if (blockedRequest || context.pages().length !== 1) reject();
    attestation = createBrowserAttestation({
      before,
      after,
      seekAction,
      video,
      binding,
      expectedBindingHmac,
      probeContext,
      macKeyFd,
    });
  } catch {
    failure = new BrowserRunnerFailure();
  } finally {
    if (context !== null) {
      try { await withTimeout(context.close(), timeoutMs); } catch { failure = new BrowserRunnerFailure(); }
    }
    if (browser !== null) {
      try { await withTimeout(browser.close(), timeoutMs); } catch { failure = new BrowserRunnerFailure(); }
    }
    if (blockedRequest) failure = new BrowserRunnerFailure();
    if (settings) {
      settings.developmentProjectRef = "";
      settings.developmentTargetHmac = "";
      settings.browserTargetHmac = "";
      settings.nonce = "";
    }
    if (binding) {
      binding.sessionId = "";
      binding.sourceRunId = "";
    }
    if (probeContext) {
      probeContext.developmentTargetHmac = "";
      probeContext.browserTargetHmac = "";
      probeContext.expectedBindingHmac = "";
    }
    key.fill(0);
    if (probeKey !== null) probeKey.fill(0);
    probeKeyHex = "";
    expectedBindingHmac = "";
  }
  if (failure !== null || attestation === null) throw failure ?? new BrowserRunnerFailure();
  try {
    writeBrowserAttestation(receiptFd, attestation);
  } catch {
    reject();
  }
  return attestation;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  if (process.argv.length !== 2) {
    process.exitCode = 70;
  } else {
    runProtectedBrowserProbe().then(
      () => { process.exitCode = 0; },
      () => { process.exitCode = 70; },
    );
  }
}
