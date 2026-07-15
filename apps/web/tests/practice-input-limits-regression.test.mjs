import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "../..");
const readWeb = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");
const inputLimitsModuleUrl = pathToFileURL(
  path.join(webRoot, "src/lib/practice/input-limits.ts"),
).href;
const boundedJsonModuleUrl = pathToFileURL(
  path.join(webRoot, "src/server/http/bounded-json.ts"),
).href;

async function loadInputLimits() {
  return import(inputLimitsModuleUrl);
}

async function loadBoundedJson() {
  return import(boundedJsonModuleUrl);
}

function assertValidationError(run, field) {
  assert.throws(run, (error) => {
    assert.equal(error?.code, "validation_error");
    assert.equal(typeof error?.details?.[field], "string");
    return true;
  });
}

function streamedRequest(chunks, headers = {}) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream(
    {
      pull(controller) {
        pulls += 1;
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  return {
    request: new Request("http://localhost/api/v1/practice-sessions", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      duplex: "half",
    }),
    stats: () => ({ pulls, cancelled }),
  };
}

function chunk(bytes, size = 1024) {
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    chunks.push(bytes.slice(offset, offset + size));
  }
  return chunks;
}

function jsonBodyWithByteLength(byteLength) {
  const prefix = '{"value":"';
  const suffix = '"}';
  const fillerLength = byteLength - Buffer.byteLength(prefix + suffix);
  assert.ok(fillerLength >= 0);
  return new TextEncoder().encode(prefix + "a".repeat(fillerLength) + suffix);
}

test("practice input limits expose the locked code-point and byte contracts", async () => {
  const { PRACTICE_INPUT_LIMITS } = await loadInputLimits();

  assert.equal(PRACTICE_INPUT_LIMITS.sceneFieldCodePoints, 2_000);
  assert.equal(PRACTICE_INPUT_LIMITS.sceneAggregateCodePoints, 4_000);
  assert.equal(PRACTICE_INPUT_LIMITS.replyCodePoints, 2_000);
  assert.equal(PRACTICE_INPUT_LIMITS.jsonBodyBytes, 64 * 1_024);
});

test("Unicode counting treats Korean, combining marks, and astral emoji as code points", async () => {
  const { countUnicodeCodePoints } = await loadInputLimits();

  assert.equal(countUnicodeCodePoints("한글"), 2);
  assert.equal(countUnicodeCodePoints("e\u0301"), 2);
  assert.equal(countUnicodeCodePoints("😀"), 1);
  assert.equal(countUnicodeCodePoints("😀".repeat(2_000)), 2_000);
});

for (const field of ["situation", "characterContext", "subtext"]) {
  test(`${field} accepts 2,000 code points and rejects 2,001`, async () => {
    const { validateSceneContext } = await loadInputLimits();
    const valid = { situation: "가", characterContext: "나", subtext: "다" };

    assert.equal(
      validateSceneContext({ ...valid, [field]: "😀".repeat(2_000) })[field],
      "😀".repeat(2_000),
    );
    assertValidationError(
      () => validateSceneContext({ ...valid, [field]: "😀".repeat(2_001) }),
      field,
    );
  });
}

test("scene context accepts a 4,000 aggregate and rejects 4,001", async () => {
  const { validateSceneContext } = await loadInputLimits();

  assert.deepEqual(validateSceneContext({
    situation: "가".repeat(2_000),
    characterContext: "나".repeat(1_999),
    subtext: "다",
  }), {
    situation: "가".repeat(2_000),
    characterContext: "나".repeat(1_999),
    subtext: "다",
  });
  assertValidationError(
    () => validateSceneContext({
      situation: "가".repeat(2_000),
      characterContext: "나".repeat(2_000),
      subtext: "다",
    }),
    "sceneContext",
  );
});

test("scene limits apply after whitespace normalization", async () => {
  const { validateSceneContext } = await loadInputLimits();
  const normalized = validateSceneContext({
    situation: `  ${"가".repeat(1_000)}\n\t${"나".repeat(999)}  `,
    characterContext: " 인물 ",
    subtext: " 의도 ",
  });

  assert.equal(normalized.situation, `${"가".repeat(1_000)} ${"나".repeat(999)}`);
});

test("reply accepts 2,000 trimmed code points and preserves internal newlines", async () => {
  const { validateReplyText } = await loadInputLimits();
  const text = `${"가".repeat(999)}\n${"😀".repeat(1_000)}`;

  assert.equal(validateReplyText(`  ${text}  `), text);
});

test("reply rejects 2,001 code points after trimming", async () => {
  const { validateReplyText } = await loadInputLimits();

  assertValidationError(() => validateReplyText(`  ${"😀".repeat(2_001)}  `), "text");
});

test("bounded JSON accepts an actual 64 KiB streamed body without Content-Length", async () => {
  const { readBoundedJson } = await loadBoundedJson();
  const bytes = jsonBodyWithByteLength(64 * 1_024);
  const { request } = streamedRequest(chunk(bytes));

  const payload = await readBoundedJson(request);
  assert.equal(payload.value.length, bytes.byteLength - Buffer.byteLength('{"value":""}'));
});

test("bounded JSON rejects actual bytes above 64 KiB despite a false low Content-Length", async () => {
  const { readBoundedJson } = await loadBoundedJson();
  const bytes = jsonBodyWithByteLength(64 * 1_024 + 1);
  const stream = streamedRequest(chunk(bytes), { "content-length": "12" });

  await assert.rejects(readBoundedJson(stream.request), (error) => {
    assert.equal(error?.status, 413);
    assert.equal(error?.code, "payload_too_large");
    return true;
  });
  assert.equal(stream.stats().cancelled, true);
  assert.ok(stream.stats().pulls <= 65, "the parser must stop reading once the byte cap is crossed");
});

test("bounded JSON accepts a small body despite a false high Content-Length", async () => {
  const { readBoundedJson } = await loadBoundedJson();
  const bytes = new TextEncoder().encode('{"operation":"start"}');
  const { request } = streamedRequest(chunk(bytes, 3), { "content-length": "999999" });

  assert.deepEqual(await readBoundedJson(request), { operation: "start" });
});

test("bounded JSON decodes escaped astral input using actual wire bytes", async () => {
  const { readBoundedJson } = await loadBoundedJson();
  const escapedEmoji = "\\ud83d\\ude00".repeat(2_000);
  const bytes = new TextEncoder().encode(`{"text":"${escapedEmoji}"}`);
  const { request } = streamedRequest(chunk(bytes, 257));

  const payload = await readBoundedJson(request);
  assert.equal([...payload.text].length, 2_000);
  assert.equal(bytes.byteLength < 64 * 1_024, true);
});

test("every practice JSON mutation route uses the bounded parser", () => {
  const routes = [
    "src/app/api/v1/practice-upload-intents/route.ts",
    "src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts",
    "src/app/api/v1/practice-sessions/route.ts",
    "src/app/api/v1/practice-sessions/[sessionId]/analysis/route.ts",
    "src/app/api/v1/practice-sessions/[sessionId]/turns/route.ts",
    "src/app/api/v1/practice-sessions/[sessionId]/report/route.ts",
  ];

  for (const route of routes) {
    const source = readWeb(route);
    assert.match(source, /readBoundedJson\(request\)/, route);
    assert.doesNotMatch(source, /request\.json\(\)/, route);
  }
});

test("scene and reply validation runs before operation claims or upstream calls", () => {
  const source = readWeb("src/server/services/acting-coach-service.ts");
  const sceneValidation = source.indexOf("validateSceneContext(");
  const uploadIntentRead = source.indexOf("repository.findUploadIntent", sceneValidation);
  const replyValidation = source.indexOf("validateReplyText(");
  const replyClaim = source.indexOf('claimOperation(\n      "coach"', replyValidation);

  assert.ok(sceneValidation >= 0 && sceneValidation < uploadIntentRead);
  assert.ok(replyValidation >= 0 && replyValidation < replyClaim);
});

test("practice UI uses code-point controls and non-truncating HTML safety ceilings", () => {
  const source = readWeb("src/features/practice/practice-flow.tsx");

  assert.match(source, /countUnicodeCodePoints/);
  assert.match(source, /PRACTICE_INPUT_LIMITS\.sceneFieldCodePoints/);
  assert.match(source, /PRACTICE_INPUT_LIMITS\.sceneAggregateCodePoints/);
  assert.match(source, /PRACTICE_INPUT_LIMITS\.replyCodePoints/);
  assert.match(source, /maxLength=\{PRACTICE_INPUT_LIMITS\.sceneFieldCodePoints\s*\*\s*2\}/);
  assert.match(source, /maxLength=\{PRACTICE_INPUT_LIMITS\.replyCodePoints\s*\*\s*2\}/);
});

test("OpenAPI publishes code-point maxLength and a reusable 413 contract", () => {
  const document = JSON.parse(readWeb("src/lib/api/openapi.json"));
  const schemas = document.components.schemas;

  for (const field of ["situation", "characterContext", "subtext"]) {
    assert.equal(schemas.CreateSessionRequest.properties[field].maxLength, 2_000, field);
  }
  assert.equal(schemas.ReplyTurnRequest.properties.text.maxLength, 2_000);
  assert.match(document.components.responses.PayloadTooLarge.description, /64\s*KiB/);

  for (const pathName of [
    "/api/v1/practice-sessions",
    "/api/v1/practice-sessions/{sessionId}/analysis",
    "/api/v1/practice-sessions/{sessionId}/turns",
    "/api/v1/practice-sessions/{sessionId}/report",
  ]) {
    assert.deepEqual(document.paths[pathName].post.responses["413"], {
      $ref: "#/components/responses/PayloadTooLarge",
    });
  }
});

test("migration 016 adds database and direct security-definer RPC limits", () => {
  const migrationPath = path.join(
    repoRoot,
    "supabase/migrations/016_bound_practice_inputs.sql",
  );
  assert.equal(existsSync(migrationPath), true, "migration 016 must be additive");
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /char_length\s*\(\s*situation\s*\)\s*<=\s*2000/i);
  assert.match(sql, /char_length\s*\(\s*character_context\s*\)\s*<=\s*2000/i);
  assert.match(sql, /char_length\s*\(\s*coalesce\s*\(\s*subtext\s*,\s*''\s*\)\s*\)\s*<=\s*2000/i);
  assert.match(sql, /char_length\s*\(\s*situation\s*\)[\s\S]*char_length\s*\(\s*character_context\s*\)[\s\S]*char_length\s*\(\s*coalesce\s*\(\s*subtext\s*,\s*''\s*\)\s*\)[\s\S]*<=\s*4000/i);
  assert.match(sql, /role\s*<>\s*'actor'[\s\S]*char_length\s*\(\s*trim\s*\(\s*text\s*\)\s*\)\s*<=\s*2000/i);

  for (const rpc of [
    "acttub_create_acting_session",
    "acttub_claim_coach_reply",
    "acttub_create_session_from_upload_intent",
    "acttub_append_turn_pair",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, "i"), rpc);
  }
  assert.match(
    sql,
    /acttub_create_acting_session[\s\S]*char_length\s*\(\s*p_situation\s*\)[\s\S]*char_length\s*\(\s*p_character_context\s*\)[\s\S]*char_length\s*\(\s*coalesce\s*\(\s*p_subtext/i,
    "direct acting-session RPC calls must validate scene context",
  );
  assert.match(
    sql,
    /acttub_claim_coach_reply[\s\S]*char_length\s*\(\s*trim\s*\(\s*p_actor_text\s*\)\s*\)\s*>\s*2000/i,
    "direct reply-claim RPC calls must reject oversized actor text",
  );
  assert.match(
    sql,
    /from\s+public\.practice_sessions[\s\S]*char_length[\s\S]*(raise exception|update\s+public\.practice_sessions|delete\s+from\s+public\.practice_sessions)/i,
    "legacy rows must be audited and explicitly blocked or remediated before validation",
  );
  assert.match(sql, /not valid/i, "constraints must be staged after legacy-row audit/remediation");
  assert.match(sql, /validate constraint/i, "staged constraints must be validated explicitly");
});
