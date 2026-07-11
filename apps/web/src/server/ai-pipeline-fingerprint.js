import { createHash } from "node:crypto";

const HASH_RE = /^[0-9a-f]{64}$/;
const objectProto = Object.prototype;

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === objectProto || proto === null;
};

export const canonicalizeFingerprintValue = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_fingerprint_payload");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue);
  if (!isPlainObject(value)) throw new Error("invalid_fingerprint_payload");
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("invalid_fingerprint_payload");
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint") {
      throw new Error("invalid_fingerprint_payload");
    }
    result[key] = canonicalizeFingerprintValue(entry);
  }
  return result;
};

export const fingerprintJson = (value) =>
  createHash("sha256").update(JSON.stringify(canonicalizeFingerprintValue(value))).digest("hex");

export const isLowerHex64 = (value) => typeof value === "string" && HASH_RE.test(value);
