import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintJson, isLowerHex64 } from "../src/server/ai-pipeline-fingerprint.js";

test("canonical fingerprinting is key-order stable and lower-hex validated", () => {
  const left = { b: 2, a: { y: [3, { c: 4, a: 1 }], x: "z" }, c: null };
  const right = { c: null, a: { x: "z", y: [3, { a: 1, c: 4 }] }, b: 2 };
  const expected = fingerprintJson(left);

  assert.equal(expected, fingerprintJson(right));
  assert.ok(isLowerHex64(expected));
  assert.ok(!isLowerHex64(expected.toUpperCase()));
  assert.throws(() => fingerprintJson({ bad: undefined }), /invalid_fingerprint_payload/);
  assert.throws(() => fingerprintJson(new Date()), /invalid_fingerprint_payload/);
  assert.throws(() => fingerprintJson(NaN), /invalid_fingerprint_payload/);
  assert.throws(() => fingerprintJson(Infinity), /invalid_fingerprint_payload/);
  const sparse = []; sparse.length = 1;
  assert.throws(() => fingerprintJson(sparse), /invalid_fingerprint_payload/);
  assert.throws(() => fingerprintJson([undefined]), /invalid_fingerprint_payload/);
});
