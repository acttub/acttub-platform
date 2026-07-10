import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractCreateTable(sql, tableName) {
  const marker = `create table if not exists ${tableName} (`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing ${tableName} create table`);

  let depth = 0;
  let inSingleQuote = false;
  for (let index = start; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === "'" && next === "'") {
      index += 1;
      continue;
    }
    if (char === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;

    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && char === ";") {
      return sql.slice(start, index + 1);
    }
  }

  assert.fail(`unterminated ${tableName} create table`);
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

test("executable migration matches Slice 1 private practice video upload contract", () => {
  const sql = read("supabase/migrations/001_acttub_slice1_schema.sql");
  assert.match(sql, /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
  assert.match(sql, /values \(\s*'practice-videos',\s*'practice-videos',\s*false,\s*314572800,\s*array\['video\/mp4', 'video\/quicktime'\]\s*\)/);
  assert.match(sql, /create policy "practice videos insert via active upload intent"/);
  assert.match(sql, /ui\.status = 'created'/);
  assert.match(sql, /ui\.expected_storage_path = storage\.objects\.name/);
  assert.doesNotMatch(sql, /for select\s+to authenticated[\s\S]{0,120}storage\.objects/i);
  assert.doesNotMatch(sql, /for update\s+to authenticated[\s\S]{0,120}storage\.objects/i);
  assert.doesNotMatch(sql, /for delete\s+to authenticated[\s\S]{0,120}storage\.objects/i);
});

test("app and executable migration share upload bucket and path convention", () => {
  const sql = read("supabase/migrations/001_acttub_slice1_schema.sql");
  const service = read("apps/web/src/server/services/coach-session-service.ts");
  const env = read("apps/web/src/lib/config/env.ts");

  assert.match(service, /config\.video\.bucket !== "practice-videos"/);
  assert.match(service, /storageBucket: "practice-videos"/);
  assert.match(env, /"practice-videos"/);
  assert.match(service, /users\/\$\{userId\}\/practice-sessions\/\$\{sessionId\}\/take\.\$\{extension\}/);
  assert.match(sql, /'users\/' \|\| user_id::text \|\| '\/practice-sessions\/' \|\| session_id::text \|\| '\/take\.'/);
});

test("practice_takes is executable and owner-aligned with documented Slice 1 contract", () => {
  const migration = read("supabase/migrations/001_acttub_slice1_schema.sql");
  const docs = read("docs/supabase/slice1-schema-rls-storage.sql");
  const practiceTakes = extractCreateTable(migration, "public.practice_takes");

  assert.doesNotMatch(migration, /\bacttub\./, "migration must not depend on non-public acttub schema objects");
  assert.match(practiceTakes, /\buser_id uuid not null\b/);
  assert.match(practiceTakes, /\bsession_id uuid not null\b/);
  assert.doesNotMatch(practiceTakes, /references\s+acttub\.coach_sessions/i);
  assert.match(practiceTakes, /foreign key \(session_id, user_id\) references public\.practice_sessions\(id, user_id\) on delete cascade/);
  assert.match(practiceTakes, /unique \(id, user_id\)/);
  assert.match(practiceTakes, /storage_bucket text not null default 'practice-videos'/);
  assert.match(practiceTakes, /storage_path text not null unique/);
  assert.match(practiceTakes, /mime_type text not null check \(mime_type in \('video\/mp4', 'video\/quicktime'\)\)/);
  assert.match(practiceTakes, /size_bytes bigint not null check \(size_bytes > 0 and size_bytes <= 314572800\)/);
  assert.match(practiceTakes, /analysis_status text not null default 'generated'\s+check \(analysis_status in \('generated', 'failed'\)\)/);
  assert.equal(normalizeSql(practiceTakes), normalizeSql(extractCreateTable(docs, "public.practice_takes")));
});

test("child tables use composite owner foreign keys for session and take ownership", () => {
  const sql = read("supabase/migrations/001_acttub_slice1_schema.sql");
  const observations = extractCreateTable(sql, "public.observations");
  const questionTurns = extractCreateTable(sql, "public.question_turns");
  const sessionResults = extractCreateTable(sql, "public.session_results");
  const validationEvents = extractCreateTable(sql, "public.validation_events");

  assert.match(observations, /foreign key \(session_id, user_id\) references public\.practice_sessions\(id, user_id\) on delete cascade/);
  assert.match(observations, /foreign key \(take_id, user_id\) references public\.practice_takes\(id, user_id\) on delete cascade/);
  for (const tableSql of [questionTurns, sessionResults, validationEvents]) {
    assert.match(tableSql, /foreign key \(session_id, user_id\) references public\.practice_sessions\(id, user_id\) on delete cascade/);
  }
});

test("migration SQL has balanced structural delimiters", () => {
  const sql = read("supabase/migrations/001_acttub_slice1_schema.sql");
  let parenDepth = 0;
  let dollarTag = null;
  let inSingleQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    const remaining = sql.slice(index);

    if (!inSingleQuote) {
      const dollarMatch = remaining.match(/^\$[A-Za-z0-9_]*\$/);
      if (dollarMatch && dollarTag === null) {
        dollarTag = dollarMatch[0];
        index += dollarTag.length - 1;
        continue;
      }
      if (dollarTag && remaining.startsWith(dollarTag)) {
        index += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
    }
    if (dollarTag) continue;

    if (char === "'" && next === "'") {
      index += 1;
      continue;
    }
    if (char === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    assert.ok(parenDepth >= 0, "SQL has an unexpected closing parenthesis");
  }

  assert.equal(inSingleQuote, false, "SQL has an unterminated string literal");
  assert.equal(dollarTag, null, "SQL has an unterminated dollar-quoted block");
  assert.equal(parenDepth, 0, "SQL has unbalanced parentheses");
  assert.match(sql.trimEnd(), /;$/);
});

test("security definer RPCs are execute-restricted to service role only", () => {
  const migration = read("supabase/migrations/001_acttub_slice1_schema.sql");
  const docs = read("docs/supabase/slice1-schema-rls-storage.sql");
  const sources = [migration, docs];
  const functions = [
    "public.acttub_create_session_from_upload_intent(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, numeric, integer, integer, text, text, uuid[], timestamptz)",
    "public.acttub_append_turn_pair(uuid, uuid, uuid, text, text, uuid, text, text, uuid[], timestamptz)",
    "public.acttub_complete_session(uuid, uuid, text, jsonb, text)",
  ];

  for (const source of sources) {
    for (const functionSignature of functions) {
      const escapedSignature = functionSignature.replace(/[()[\]]/g, "\\$&");
      assert.match(
        source,
        new RegExp(`revoke execute on function ${escapedSignature} from public, anon, authenticated;`),
      );
      assert.match(
        source,
        new RegExp(`grant execute on function ${escapedSignature} to service_role;`),
      );
    }
  }
});

test("turn append migration serializes and rejects stale or completed dialogue appends", () => {
  const sql = read("supabase/migrations/003_atomic_dialogue_turn_append.sql");
  const newSignature =
    "public.acttub_append_turn_pair(uuid, uuid, integer, uuid, text, text, uuid, text, text, uuid[], timestamptz)";
  const normalized = normalizeSql(sql);

  assert.match(
    normalized,
    /drop function if exists public\.acttub_append_turn_pair\( uuid, uuid, uuid, text, text, uuid, text, text, uuid\[\], timestamptz \);/,
  );
  assert.match(sql, /p_expected_actor_answer_count integer/);
  assert.match(sql, /returns table\(session_id uuid, actor_answer_count integer\)/);
  assert.match(
    normalized,
    /from public\.practice_sessions s .* for update;/,
  );
  assert.match(sql, /select count\(\*\)::integer[\s\S]*qt\.speaker = 'actor'/);
  assert.match(sql, /qt\.speaker = 'acttub'[\s\S]*order by qt\.created_at desc, qt\.id desc/);
  assert.match(sql, /v_latest_coach_question_focus = 'summary_reflection'/);
  assert.match(sql, /v_actor_answer_count >= 10/);
  assert.match(
    sql,
    /v_actor_answer_count is distinct from p_expected_actor_answer_count/,
  );
  assert.match(sql, /return query select p_session_id, v_actor_answer_count/);

  const escapedSignature = newSignature.replace(/[()[\]]/g, "\\$&");
  assert.match(
    sql,
    new RegExp(
      `revoke execute on function ${escapedSignature} from public, anon, authenticated;`,
    ),
  );
  assert.match(
    sql,
    new RegExp(`grant execute on function ${escapedSignature} to service_role;`),
  );

  const summaryGuard = sql.indexOf("v_latest_coach_question_focus = 'summary_reflection'");
  const maxGuard = sql.indexOf("v_actor_answer_count >= 10");
  const expectedGuard = sql.indexOf(
    "v_actor_answer_count is distinct from p_expected_actor_answer_count",
  );
  const firstInsert = sql.indexOf("insert into public.question_turns");
  assert.ok(summaryGuard < maxGuard);
  assert.ok(maxGuard < expectedGuard);
  assert.ok(expectedGuard < firstInsert);
});

test("additive privilege closure migration revokes anon and session-deletion authenticated select", () => {
  const closure = read("supabase/migrations/005_close_ai_table_select_privilege_gaps.sql");

  assert.match(
    closure,
    /revoke select on public\.ai_session_summaries, public\.ai_runs, public\.actor_corrections, public\.interview_turns, public\.ai_reports, public\.session_deletion_attempts from anon;/,
  );
  assert.match(closure, /revoke select on public\.session_deletion_attempts from authenticated;/);
  assert.doesNotMatch(closure, /grant select/i);
  assert.doesNotMatch(
    closure,
    /revoke select on public\.(?:ai_session_summaries|ai_runs|actor_corrections|interview_turns|ai_reports) from authenticated;/,
  );
});

test("pipeline security hardening migration alters only function settings and invoker mode", () => {
  const hardening = read("supabase/migrations/006_pipeline_security_advisor_hardening.sql");
  const terms = read("supabase/migrations/001_acttub_slice1_schema.sql");
  const pipeline = read("supabase/migrations/004_ai_pipeline_data_plane.sql");

  assert.match(hardening, /alter function public\.current_acttub_terms_version\(\) set search_path = public;/);
  assert.match(
    hardening,
    /alter function public\.current_acttub_ai_processing_consent_version\(\) set search_path = public;/,
  );
  assert.match(hardening, /alter function public\.is_active_acttub_profile\(uuid\) security invoker;/);
  assert.doesNotMatch(hardening, /\bgrant\b|\brevoke\b|\bpolicy\b/i);

  assert.match(terms, /create or replace function public\.current_acttub_terms_version\(\)/);
  assert.match(terms, /create or replace function public\.is_active_acttub_profile\(profile_user_id uuid\)[\s\S]*security definer[\s\S]*set search_path = public/);
  assert.match(pipeline, /create or replace function public\.current_acttub_ai_processing_consent_version\(\) returns text language sql immutable as \$\$ select 'ai-processing\.v1'::text \$\$/);

  assert.match(terms, /public\.is_active_acttub_profile\(auth\.uid\(\)\)/);
  assert.match(pipeline, /public\.current_acttub_terms_version\(\)/);
  assert.match(pipeline, /public\.current_acttub_ai_processing_consent_version\(\)/);
  assert.match(terms, /public\.is_active_acttub_profile\(auth\.uid\(\)\)/);
  assert.doesNotMatch(hardening, /security definer/i);
});
