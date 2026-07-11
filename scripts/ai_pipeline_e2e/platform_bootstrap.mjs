import fs from "node:fs";

const MAX_SETTINGS_BYTES = 64 * 1024;
const ALLOWED_KEYS = new Set([
  "ACTTUB_AI_AGENT_URL",
  "ACTTUB_AI_REPORT_URL",
  "ACTTUB_AI_SUMMARY_URL",
  "ACTTUB_AI_TIMEOUT_MS",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NODE_ENV",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

function fail() {
  process.exitCode = 70;
  throw new Error("platform_bootstrap_failed");
}

function parseFlatStringObject(source) {
  let cursor = 0;
  const skipWhitespace = () => {
    while (/[ \t\r\n]/u.test(source[cursor] ?? "")) cursor += 1;
  };
  const readJsonString = () => {
    if (source[cursor] !== '"') fail();
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < source.length) {
      const character = source[cursor];
      cursor += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        try {
          return JSON.parse(source.slice(start, cursor));
        } catch {
          fail();
        }
      }
    }
    fail();
  };

  skipWhitespace();
  if (source[cursor] !== "{") fail();
  cursor += 1;
  const value = Object.create(null);
  const keys = new Set();
  skipWhitespace();
  if (source[cursor] === "}") fail();
  while (cursor < source.length) {
    const key = readJsonString();
    if (typeof key !== "string" || keys.has(key)) fail();
    keys.add(key);
    skipWhitespace();
    if (source[cursor] !== ":") fail();
    cursor += 1;
    skipWhitespace();
    const item = readJsonString();
    if (typeof item !== "string") fail();
    value[key] = item;
    skipWhitespace();
    if (source[cursor] === "}") {
      cursor += 1;
      break;
    }
    if (source[cursor] !== ",") fail();
    cursor += 1;
    skipWhitespace();
  }
  skipWhitespace();
  if (cursor !== source.length) fail();
  return value;
}

function readSettings() {
  const chunks = [];
  let total = 0;
  while (total <= MAX_SETTINGS_BYTES) {
    const remaining = MAX_SETTINGS_BYTES + 1 - total;
    const chunk = Buffer.allocUnsafe(Math.min(16 * 1024, remaining));
    const bytesRead = fs.readSync(0, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total === 0 || total > MAX_SETTINGS_BYTES) fail();
  const input = Buffer.concat(chunks, total);
  const source = input.toString("utf8");
  if (source.includes("�")) fail();
  const value = parseFlatStringObject(source);
  if (Object.keys(value).length !== ALLOWED_KEYS.size || Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) fail();
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.length === 0 || item.includes("\0")) fail();
  }
  if (value.NODE_ENV !== "production" || !/^\d{3,6}$/.test(value.ACTTUB_AI_TIMEOUT_MS)) fail();
  const timeout = Number(value.ACTTUB_AI_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300_000) fail();
  for (const key of ["ACTTUB_AI_AGENT_URL", "ACTTUB_AI_REPORT_URL", "ACTTUB_AI_SUMMARY_URL", "NEXT_PUBLIC_APP_URL"]) {
    let parsed;
    try {
      parsed = new URL(value[key]);
    } catch {
      fail();
    }
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    ) fail();
  }
  let supabase;
  try {
    supabase = new URL(value.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    fail();
  }
  if (
    supabase.protocol !== "https:" ||
    !/^[a-z0-9]+\.supabase\.co$/u.test(supabase.hostname) ||
    supabase.username || supabase.password || supabase.search || supabase.hash ||
    (supabase.pathname !== "/" && supabase.pathname !== "")
  ) fail();
  for (const [key, item] of Object.entries(value)) process.env[key] = item;
}

async function main() {
  const [mode, port] = process.argv.slice(2);
  if (!new Set(["build", "start"]).has(mode)) fail();
  if (mode === "start") {
    if (!/^\d{4,5}$/.test(port ?? "")) fail();
    const numericPort = Number(port);
    if (!Number.isSafeInteger(numericPort) || numericPort < 1024 || numericPort > 65535) fail();
  }
  readSettings();
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  process.argv = [process.execPath, "next", mode, ...(mode === "start" ? ["--hostname", "127.0.0.1", "--port", port] : [])];
  await import("next/dist/bin/next");
}

main().catch(() => {
  process.exitCode = 70;
});
