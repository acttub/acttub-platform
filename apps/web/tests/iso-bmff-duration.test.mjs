import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_VIDEO_DURATION_MS,
  MediaDurationError,
  parseIsoBmffDurationMs,
  validateVideoDurationMs,
} from "../src/server/media/iso-bmff-duration.ts";

const u32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const u64 = (value) => [...u32(Number((BigInt(value) >> 32n) & 0xffffffffn)), ...u32(Number(BigInt(value) & 0xffffffffn))];
const type = (value) => [...value].map((character) => character.charCodeAt(0));
const box = (name, payload, extended = false) => new Uint8Array(
  extended
    ? [...u32(1), ...type(name), ...u64(payload.length + 16), ...payload]
    : [...u32(payload.length + 8), ...type(name), ...payload],
);
const concat = (...parts) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
};
const mvhd = ({ version = 0, timescale = 1000, duration = 300000n, extended = false } = {}) => {
  const fields = version === 0
    ? [version, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(Number(duration))]
    : [version, 0, 0, 0, ...u64(0), ...u64(0), ...u32(timescale), ...u64(duration)];
  return box("mvhd", fields, extended);
};
const movie = (header, extended = false) => concat(box("ftyp", [0, 0, 0, 0]), box("moov", header, extended));

const rejectsWith = (input, code) => assert.throws(
  () => parseIsoBmffDurationMs(input),
  (error) => error instanceof MediaDurationError && error.code === code,
);

test("parses mvhd version zero and accepts exactly five minutes", () => {
  assert.equal(parseIsoBmffDurationMs(movie(mvhd())), 300000);
  assert.equal(validateVideoDurationMs(300000), MAX_VIDEO_DURATION_MS);
});

test("parses mvhd version one and extended-size containers safely", () => {
  const bytes = movie(mvhd({ version: 1, timescale: 90000, duration: 135000n, extended: true }), true);
  assert.equal(parseIsoBmffDurationMs(bytes), 1500);
});

test("rounds canonical milliseconds and rejects durations over the limit", () => {
  assert.equal(parseIsoBmffDurationMs(movie(mvhd({ timescale: 3, duration: 1n }))), 333);
  assert.throws(() => validateVideoDurationMs(300001), (error) => error.code === "VIDEO_DURATION_EXCEEDED");
});

test("rejects truncated, missing, invalid, unsupported, and zero-timescale metadata", () => {
  rejectsWith(movie(mvhd()).subarray(0, 20), "INVALID_MEDIA_METADATA");
  rejectsWith(box("ftyp", [0, 0, 0, 0]), "INVALID_MEDIA_METADATA");
  rejectsWith(movie(box("free", [])), "INVALID_MEDIA_METADATA");
  rejectsWith(movie(mvhd({ version: 2 })), "UNSUPPORTED_MEDIA_METADATA");
  rejectsWith(movie(mvhd({ timescale: 0 })), "INVALID_MEDIA_METADATA");
});

test("duration validation rejects unreadable and non-positive values", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateVideoDurationMs(value), (error) => error.code === "VIDEO_DURATION_REQUIRED");
  }
});
