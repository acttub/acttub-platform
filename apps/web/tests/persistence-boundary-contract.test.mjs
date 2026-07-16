import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

function hasUseClientDirective(source) {
  return /^\s*["']use client["']\s*;?/.test(source);
}

test("practice persistence is isolated behind the Supabase server repository", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");

  assert.match(service, /supabaseCoachSessionRepository/);
  assert.match(service, /requireSupabaseConfigured/);
  assert.doesNotMatch(service, new RegExp("mo" + "ckCoachSessionRepository|globalThis\\.__acttub"));
  assert.equal(existsSync(path.join(appRoot, "src/server/repositories/" + "mo" + "ck-coach-session-repository.ts")), false);
  assert.match(repository, /import "server-only"/);
  assert.match(repository, /createSupabaseAdminClient/);
});

test("client modules do not import server persistence, Supabase admin, or Gemini service", () => {
  const clientFiles = walk(path.join(appRoot, "src")).filter((file) => {
    if (
      file.includes(`${path.sep}server${path.sep}`) ||
      file.includes(`${path.sep}app${path.sep}api${path.sep}`) ||
      file.includes(`${path.sep}app${path.sep}auth${path.sep}`)
    ) {
      return false;
    }

    if (file.includes(`${path.sep}app${path.sep}`)) {
      return hasUseClientDirective(readFileSync(file, "utf8"));
    }

    return true;
  });
  const relativeClientFiles = clientFiles.map((file) => path.relative(repoRoot, file));
  assert.equal(relativeClientFiles.includes("apps/web/src/app/page.tsx"), false);
  assert.equal(relativeClientFiles.includes("apps/web/src/features/practice/practice-flow.tsx"), true);
  assert.equal(relativeClientFiles.includes("apps/web/src/features/practice/terms-gate.tsx"), true);

  const offenders = clientFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes("@/server/") || source.includes("@/lib/supabase/admin") || source.includes("geminiQuestionService");
  }).map((file) => path.relative(repoRoot, file));
  assert.deepEqual(offenders, []);
});

test("Supabase service-role access is isolated to the server-only admin module", () => {
  const config = readApp("src/lib/config/env.ts");
  const admin = readApp("src/lib/supabase/admin.ts");

  assert.doesNotMatch(config, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(config, /getSupabaseServiceRoleKey/);
  assert.match(admin, /import "server-only"/);
  assert.match(admin, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /function getSupabaseServiceRoleKey\(\): string \| null/);
});

test("upload intents and session lifecycle source Supabase without local mirroring", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const repository = readApp("src/server/repositories/supabase-coach-session-repository.ts");

  assert.match(repository, /createUploadIntent\(uploadIntent: PracticeUploadIntentDto\)[\s\S]*\.from\("upload_intents"\)[\s\S]*\.insert\(\{/);
  assert.match(service, /supabaseCoachSessionRepository\.createUploadIntent\(uploadIntent\)/);
  assert.match(service, /return uploadIntent;/);
  assert.match(service, /readUploadIntentForOwner[\s\S]*supabaseCoachSessionRepository\.findUploadIntent\(uploadIntentId, userId\)/);
  assert.doesNotMatch(service, new RegExp("saveUploadIntent|markUploadIntentFinalized|mirrorSupabaseSessionTo" + "M" + "ock"));
});

test("Gemini question generation is server-only and has no static question fallback", () => {
  const service = readApp("src/server/services/coach-session-service.ts");
  const gemini = readApp("src/server/services/gemini-question-service.ts");

  assert.match(gemini, /import "server-only"/);
  assert.match(gemini, /GEMINI_INTERACTIONS_ENDPOINT/);
  assert.match(gemini, /DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"/);
  assert.match(service, /geminiQuestionService\.createInitialQuestion/);
  assert.match(service, /geminiQuestionService\.createObservationFollowUp/);
  assert.match(service, /geminiQuestionService\.createNextQuestion/);
  assert.match(service, /geminiQuestionService\.createQuestionToRevisit/);
  assert.doesNotMatch(service, new RegExp("focusQuestions|buildCoachQuestion|build" + "M" + "ockObservationText"));
});
