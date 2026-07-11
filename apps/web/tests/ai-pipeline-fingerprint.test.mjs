import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const canonicalize = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object") throw new Error("invalid_fingerprint_payload");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const fingerprintJson = (value) => createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
const isLowerHex64 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

test("canonical fingerprinting is key-order stable and lower-hex validated", () => {
  const left = { b: 2, a: { y: [3, { c: 4, a: 1 }], x: "z" }, c: null };
  const right = { c: null, a: { x: "z", y: [3, { a: 1, c: 4 }] }, b: 2 };
  const expected = "b61ce97aaa92dcf8e2b23398259ff10dbd98d6d11d4899273e0f6addaee46a99";

  assert.equal(fingerprintJson(left), expected);
  assert.equal(fingerprintJson(right), expected);
  assert.ok(isLowerHex64(expected));
  assert.ok(!isLowerHex64(expected.toUpperCase()));
});
