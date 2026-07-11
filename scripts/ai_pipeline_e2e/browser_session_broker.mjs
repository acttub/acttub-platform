import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevelopmentTarget } from "./development_target.mjs";

const INPUT_FD = 3;
const MAC_KEY_FD = 4;
const RECEIPT_FD = 5;
const READINESS_FD = 6;
const LOOPBACK_HOST = "127.0.0.1";
const INPUT_SCHEMA = "browser-session-handoff.v1";
const RECEIPT_SCHEMA = "browser-session-handoff-receipt.v1";
const READINESS_SCHEMA = "browser-session-broker-readiness.v1";
const OPERATION = "browser_session_handoff";
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_KEY_BYTES = 4096;
const MAX_COOKIE_COUNT = 16;
const MAX_COOKIE_BYTES = 8192;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const HMAC_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const RECEIPT_DOMAIN = Buffer.from("acttub-browser-session-handoff-receipt.v1\0", "ascii");
const COOKIE_DOMAIN = Buffer.from("acttub-browser-session-handoff-cookies.v1\0", "ascii");
const NONCE_DOMAIN = Buffer.from("acttub-browser-session-handoff-nonce.v1\0", "ascii");
const TARGET_DOMAIN = Buffer.from("acttub-browser-session-handoff-target.v1\0", "ascii");

class BrokerFailure extends Error {
  constructor() {
    super("BROWSER_SESSION_HANDOFF_FAILED");
    this.name = "BrokerFailure";
  }
}

function reject() {
  throw new BrokerFailure();
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject();
  return value;
}

function parseUniqueJson(input) {
  if (!Buffer.isBuffer(input) || input.length < 1 || input.length > MAX_INPUT_BYTES) reject();
  const source = input.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(input)) reject();
  let cursor = 0;
  let items = 0;

  const whitespace = () => {
    while (source[cursor] === " " || source[cursor] === "\n" || source[cursor] === "\r" || source[cursor] === "\t") cursor += 1;
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
        try {
          parsed = JSON.parse(source.slice(start, cursor));
        } catch {
          reject();
        }
        if (typeof parsed !== "string" || parsed.includes("\0") || Buffer.byteLength(parsed, "utf8") > 32 * 1024) reject();
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
  const value = (depth) => {
    if (depth > 4) reject();
    whitespace();
    if (source[cursor] === '"') return stringValue();
    if (source[cursor] === "{") {
      cursor += 1;
      const result = Object.create(null);
      const keys = new Set();
      whitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return result;
      }
      while (cursor < source.length) {
        whitespace();
        const key = stringValue();
        if (keys.has(key)) reject();
        keys.add(key);
        items += 1;
        if (items > 64) reject();
        whitespace();
        if (source[cursor] !== ":") reject();
        cursor += 1;
        result[key] = value(depth + 1);
        whitespace();
        if (source[cursor] === "}") {
          cursor += 1;
          return result;
        }
        if (source[cursor] !== ",") reject();
        cursor += 1;
      }
      reject();
    }
    if (source.startsWith("true", cursor)) {
      cursor += 4;
      return true;
    }
    if (source.startsWith("false", cursor)) {
      cursor += 5;
      return false;
    }
    if (source.startsWith("null", cursor)) {
      cursor += 4;
      return null;
    }
    const match = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)/u);
    if (!match) reject();
    cursor += match[0].length;
    const parsed = Number(match[0]);
    if (!Number.isSafeInteger(parsed)) reject();
    return parsed;
  };

  const parsed = value(0);
  whitespace();
  if (cursor !== source.length) reject();
  return parsed;
}

function ensurePrivateStreamFd(fd) {
  if (!Number.isInteger(fd) || fd <= 2) reject();
  let info;
  try {
    info = fs.fstatSync(fd);
  } catch {
    reject();
  }
  if (!(info.isSocket() || info.isFIFO())) reject();
  return info;
}

function readBounded(fd, maximum) {
  ensurePrivateStreamFd(fd);
  const chunks = [];
  let total = 0;
  while (total <= maximum) {
    const chunk = Buffer.alloc(Math.min(4096, maximum + 1 - total));
    let count;
    try {
      count = fs.readSync(fd, chunk, 0, chunk.length, null);
    } catch {
      reject();
    }
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    total += count;
  }
  if (total < 1 || total > maximum) reject();
  return Buffer.concat(chunks, total);
}

function writeAll(fd, value) {
  ensurePrivateStreamFd(fd);
  let offset = 0;
  while (offset < value.length) {
    let count;
    try {
      count = fs.writeSync(fd, value, offset, value.length - offset, null);
    } catch {
      reject();
    }
    if (count <= 0) reject();
    offset += count;
  }
}

function closeStreamFd(fd) {
  try {
    fs.closeSync(fd);
  } catch {
    // The descriptor is parent-observable only through its bounded frame or EOF.
  }
}

function publishReadiness(fd) {
  ensurePrivateStreamFd(fd);
  const frame = Buffer.from(`${canonicalJson({ schemaVersion: READINESS_SCHEMA, ready: true })}\n`, "ascii");
  try {
    const count = fs.writeSync(fd, frame, 0, frame.length, null);
    if (count !== frame.length) reject();
  } catch (error) {
    if (error instanceof BrokerFailure) throw error;
    reject();
  } finally {
    frame.fill(0);
    closeStreamFd(fd);
  }
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

function hmacBytes(key, domain, value) {
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(domain).update(value).digest("hex")}`;
}

function hmacValue(key, domain, value) {
  return hmacBytes(key, domain, Buffer.from(canonicalJson(value), "ascii"));
}

function privateSettings(fd, key) {
  const raw = readBounded(fd, MAX_INPUT_BYTES);
  let value;
  try {
    value = parseUniqueJson(raw);
  } finally {
    raw.fill(0);
  }
  const item = exactObject(value, [
    "schemaVersion",
    "supabaseUrl",
    "publishableKey",
    "accessToken",
    "refreshToken",
    "nonce",
    "brokerPort",
    "targetPort",
    "targetPath",
    "developmentTargetHmac",
  ]);
  if (item.schemaVersion !== INPUT_SCHEMA) reject();
  for (const field of ["supabaseUrl", "publishableKey", "accessToken", "refreshToken", "nonce", "targetPath", "developmentTargetHmac"]) {
    if (typeof item[field] !== "string" || item[field].includes("\0") || Buffer.byteLength(item[field], "utf8") > 32 * 1024) reject();
  }
  if (item.publishableKey.length < 16 || item.accessToken.length < 16 || item.refreshToken.length < 16) reject();
  if (![item.publishableKey, item.accessToken, item.refreshToken].every((field) => /^[\x21-\x7e]+$/u.test(field))) reject();
  if (!NONCE_PATTERN.test(item.nonce) || !HMAC_PATTERN.test(item.developmentTargetHmac)) reject();
  for (const port of [item.brokerPort, item.targetPort]) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) reject();
  }
  if (
    !/^\/[a-zA-Z0-9/_\-.]{0,2047}$/u.test(item.targetPath) ||
    item.targetPath.startsWith("//") ||
    item.targetPath.includes("..") ||
    item.targetPath.includes(item.accessToken) ||
    item.targetPath.includes(item.refreshToken)
  ) reject();
  try { assertDevelopmentTarget(key, item.supabaseUrl, item.developmentTargetHmac); }
  catch { reject(); }
  return item;
}

async function defaultDependencyLoader() {
  let ssr;
  let serializer;
  try {
    const packageUrl = new URL("../../apps/web/node_modules/@supabase/ssr/package.json", import.meta.url);
    const packagePath = fs.realpathSync(fileURLToPath(packageUrl));
    ssr = await import(new URL("dist/module/index.js", pathToFileURL(packagePath)));
    serializer = createRequire(packagePath)("cookie").serialize;
  } catch {
    reject();
  }
  if (typeof ssr.createServerClient !== "function" || typeof serializer !== "function") reject();
  return { createServerClient: ssr.createServerClient, serializeCookie: serializer };
}

function validateCookie(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) reject();
  const actual = Object.keys(item).sort();
  if (actual.join(",") !== "name,options,value") reject();
  if (typeof item.name !== "string" || typeof item.value !== "string" || !item.options || typeof item.options !== "object" || Array.isArray(item.options)) reject();
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(item.name) || item.value.includes("\r") || item.value.includes("\n")) reject();
  return item;
}

async function sessionCookieHeaders(settings, dependencyLoader) {
  const dependencies = await dependencyLoader();
  if (!dependencies || typeof dependencies.createServerClient !== "function" || typeof dependencies.serializeCookie !== "function") reject();
  const cookies = [];
  const client = dependencies.createServerClient(settings.supabaseUrl, settings.publishableKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll(values) {
        if (!Array.isArray(values) || cookies.length + values.length > MAX_COOKIE_COUNT) reject();
        for (const value of values) cookies.push(validateCookie(value));
      },
    },
  });
  if (!client?.auth || typeof client.auth.setSession !== "function") reject();
  let result;
  const sessionPayload = {
    access_token: settings.accessToken,
    refresh_token: settings.refreshToken,
  };
  try {
    result = await client.auth.setSession(sessionPayload);
  } catch {
    reject();
  } finally {
    sessionPayload.access_token = "";
    sessionPayload.refresh_token = "";
  }
  if (!result || result.error || !result.data?.session || cookies.length < 1 || cookies.length > MAX_COOKIE_COUNT) reject();
  const headers = cookies.map((cookie) => {
    let header;
    try {
      header = dependencies.serializeCookie(cookie.name, cookie.value, cookie.options);
    } catch {
      reject();
    }
    if (typeof header !== "string" || Buffer.byteLength(header, "utf8") < 1 || Buffer.byteLength(header, "utf8") > MAX_COOKIE_BYTES || /[\r\n]/u.test(header)) reject();
    return header;
  });
  cookies.splice(0, cookies.length);
  return headers;
}

function safeReceipt(key, settings, cookieHeaders) {
  const target = Buffer.from(`${LOOPBACK_HOST}\0${settings.targetPort}\0${settings.targetPath}`, "ascii");
  const semantic = {
    schemaVersion: RECEIPT_SCHEMA,
    operation: OPERATION,
    success: true,
    cookieCount: cookieHeaders.length,
    cookieHeadersHmac: hmacBytes(key, COOKIE_DOMAIN, Buffer.from(cookieHeaders.join("\0"), "utf8")),
    nonceHmac: hmacBytes(key, NONCE_DOMAIN, Buffer.from(settings.nonce, "ascii")),
    targetHmac: hmacBytes(key, TARGET_DOMAIN, target),
    developmentTargetHmac: settings.developmentTargetHmac,
  };
  return { ...semantic, resultHmac: hmacValue(key, RECEIPT_DOMAIN, semantic) };
}

function validateReceipt(value) {
  const item = exactObject(value, [
    "schemaVersion", "operation", "success", "cookieCount", "cookieHeadersHmac",
    "nonceHmac", "targetHmac", "developmentTargetHmac", "resultHmac",
  ]);
  if (item.schemaVersion !== RECEIPT_SCHEMA || item.operation !== OPERATION || item.success !== true || !Number.isSafeInteger(item.cookieCount) || item.cookieCount < 1 || item.cookieCount > MAX_COOKIE_COUNT) reject();
  for (const field of ["cookieHeadersHmac", "nonceHmac", "targetHmac", "developmentTargetHmac", "resultHmac"]) {
    if (!HMAC_PATTERN.test(item[field])) reject();
  }
  return item;
}

function serveOnce({ settings, cookieHeaders, key, receiptFd, publishReady, timeoutMs, createServer }) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    typeof createServer !== "function" ||
    typeof publishReady !== "function"
  ) reject();
  const expectedRoute = `/__acttub_session/${settings.nonce}`;
  const expectedHost = `${LOOPBACK_HOST}:${settings.brokerPort}`;
  const redirectLocation = `http://${LOOPBACK_HOST}:${settings.targetPort}${settings.targetPath}`;
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let consumed = false;
    let server;
    let timer;
    const fail = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        server?.close();
      } catch {
        // The fixed failure is returned below.
      }
      cookieHeaders.fill("");
      rejectPromise(new BrokerFailure());
    };
    const succeed = () => {
      if (settled) return;
      try {
        const receipt = validateReceipt(safeReceipt(key, settings, cookieHeaders));
        writeAll(receiptFd, Buffer.from(`${canonicalJson(receipt)}\n`, "ascii"));
        settled = true;
        if (timer) clearTimeout(timer);
        cookieHeaders.fill("");
        resolvePromise(receipt);
      } catch {
        fail();
      }
    };
    try {
      server = createServer((request, response) => {
        if (consumed) {
          request.socket.destroy();
          return;
        }
        consumed = true;
        server.close();
        const valid =
          request.method === "GET" &&
          request.url === expectedRoute &&
          request.headers.host === expectedHost &&
          request.socket.localAddress === LOOPBACK_HOST;
        response.setHeader("Cache-Control", "no-store, max-age=0");
        response.setHeader("Content-Length", "0");
        response.setHeader("Connection", "close");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (!valid) {
          response.statusCode = 404;
          response.once("finish", fail);
          response.end();
          return;
        }
        response.statusCode = 302;
        response.setHeader("Set-Cookie", cookieHeaders);
        response.setHeader("Location", redirectLocation);
        response.once("finish", succeed);
        response.end();
      });
      server.maxConnections = 1;
      server.keepAliveTimeout = 1;
      server.requestTimeout = timeoutMs;
      server.headersTimeout = timeoutMs;
      server.once("error", fail);
      server.on("clientError", (_error, socket) => {
        consumed = true;
        socket.destroy();
        fail();
      });
      server.listen({ host: LOOPBACK_HOST, port: settings.brokerPort, exclusive: true }, () => {
        const address = server.address();
        if (!address || typeof address === "string" || address.address !== LOOPBACK_HOST || address.port !== settings.brokerPort) {
          fail();
          return;
        }
        try {
          publishReady();
          timer = setTimeout(fail, timeoutMs);
        } catch {
          fail();
        }
      });
    } catch {
      fail();
    }
  });
}

export async function serveBrowserSessionBroker({
  inputFd = INPUT_FD,
  macKeyFd = MAC_KEY_FD,
  receiptFd = RECEIPT_FD,
  readinessFd = READINESS_FD,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dependencyLoader = defaultDependencyLoader,
  createServer = http.createServer,
} = {}) {
  let readinessValidated = false;
  let readinessReleased = false;
  let key = null;
  let settings;
  try {
    if (
      typeof dependencyLoader !== "function" ||
      new Set([inputFd, macKeyFd, receiptFd, readinessFd]).size !== 4
    ) reject();
    ensurePrivateStreamFd(readinessFd);
    readinessValidated = true;
    key = readBounded(macKeyFd, MAX_KEY_BYTES);
    if (key.length < 32) reject();
    settings = privateSettings(inputFd, key);
    const cookieHeaders = await sessionCookieHeaders(settings, dependencyLoader);
    settings.supabaseUrl = "";
    settings.publishableKey = "";
    settings.accessToken = "";
    settings.refreshToken = "";
    return await serveOnce({
      settings,
      cookieHeaders,
      key,
      receiptFd,
      timeoutMs,
      createServer,
      publishReady: () => {
        publishReadiness(readinessFd);
        readinessReleased = true;
      },
    });
  } finally {
    if (readinessValidated && !readinessReleased) closeStreamFd(readinessFd);
    if (settings) {
      settings.supabaseUrl = "";
      settings.publishableKey = "";
      settings.accessToken = "";
      settings.refreshToken = "";
      settings.nonce = "";
      settings.targetPath = "";
    }
    if (key !== null) key.fill(0);
  }
}

const invokedDirectly =
  process.argv.length === 2 &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  serveBrowserSessionBroker().then(
    () => { process.exitCode = 0; },
    () => { process.exitCode = 70; },
  );
}
