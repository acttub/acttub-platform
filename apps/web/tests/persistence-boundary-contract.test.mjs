import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const readApp = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if ([".next", "node_modules"].includes(entry)) return [];
    const stats = statSync(absolute);
    if (stats.isDirectory()) return walk(absolute);
    return /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

test("session persistence is isolated behind server repository boundary", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  assert.match(service, /mockCoachSessionRepository/);
  assert.doesNotMatch(service, /globalThis\.__acttubMockCoachSessionRepository/);
  const repository = readApp("src/server/repositories/mock-coach-session-repository.ts");
  assert.match(repository, /__acttubMockCoachSessionRepository/);
  assert.match(repository, /ownerUserId/);
});

test("client modules do not import server persistence or Supabase admin", () => {
  const clientFiles = walk(path.join(appRoot, "src")).filter((file) => !file.includes(`${path.sep}server${path.sep}`) && !file.includes(`${path.sep}app${path.sep}api${path.sep}`));
  const offenders = clientFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes("@/server/") || source.includes("@/lib/supabase/admin");
  }).map((file) => path.relative(repoRoot, file));
  assert.deepEqual(offenders, []);
});

test("Supabase admin client remains server-only", () => {
  assert.match(readApp("src/lib/supabase/admin.ts"), /import "server-only"/);
});
