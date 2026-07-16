import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");

test("acting public DTOs match their required OpenAPI shape", () => {
  const types = read("src/lib/api/types.ts");

  assert.match(types, /export type ActingTakeDto = \{[\s\S]*durationMs: number;/);
  assert.match(types, /take: ActingTakeDto;/);
  assert.match(types, /report: ActingReportDto \| null;/);
  assert.match(types, /deliveryErrorCode\?: string \| null;/);
  assert.match(types, /action\?: CoachAction \| null;/);
  assert.match(types, /focusTimestamp\?: string \| null;/);
});

test("legacy public DTO preserves the persisted legacy take discriminator", () => {
  const legacyTypes = read("src/lib/api/legacy-types.ts");
  const repository = read("src/server/repositories/supabase-coach-session-repository.ts");

  assert.match(
    legacyTypes,
    /export type LegacyTakeDto = \{[\s\S]*analysisStatus: "generated" \| "failed";/,
  );
  assert.match(legacyTypes, /take: LegacyTakeDto;/);
  assert.match(legacyTypes, /legacyResult: \{[\s\S]*\} \| null;/);
  assert.doesNotMatch(legacyTypes, /legacyResult\?:/);
  assert.match(repository, /const mapLegacyTake = /);
  assert.match(repository, /take: mapLegacyTake\(row\)/);
});

test("API error details preserve documented non-string values without unsafe casts", () => {
  const types = read("src/lib/api/types.ts");
  const http = read("src/app/api/v1/http.ts");

  assert.match(types, /details\?: Record<string, unknown>;/);
  assert.match(http, /details\?: Record<string, unknown>/);
  assert.doesNotMatch(http, /as Record<string, string>/);
});
