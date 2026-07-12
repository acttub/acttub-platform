import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/server/acting-api/response-guards.ts", import.meta.url),
  "utf8",
);

test("scene summary guards require canonical nested fields without stripping unknown fields", () => {
  for (const field of [
    "timeline", "dialogue", "tempo", "pitch", "movement", "expression", "emotion",
  ]) {
    assert.match(source, new RegExp(`"${field}"`));
  }
  for (const field of [
    "start", "end", "dimension", "what", "why_odd", "likely_cause",
    "impact_on_intent", "severity_reason",
  ]) {
    assert.match(source, new RegExp(`"${field}"`));
  }
  assert.match(source, /entry\.name/);
  assert.match(source, /entry\.observation/);
  assert.match(source, /value\.overlaps_key_moment/);
  assert.match(source, /value\.on_key_dimension/);
  assert.match(source, /intentImpacts\.has\(value\.intent_impact\)/);
  assert.match(source, /severities\.has\(value\.severity\)/);
  assert.match(source, /return response;/);
});

test("coach success reasons exclude platform-only outcome_unknown", () => {
  assert.match(source, /const coachReasons = new Set\(\["gap_stated", "exhausted", "limit", "user_ended"\]\)/);
  assert.doesNotMatch(source, /coachReasons = new Set\([^;]*outcome_unknown/);
  assert.match(source, /coachReasons\.has\(response\.reason\)/);
});
