import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

const spec = JSON.parse(readFileSync(new URL("../../api/spec/openapi.json", import.meta.url)));
const publicNote = JSON.parse(readFileSync(new URL("./fixtures/practice-note.json", import.meta.url)));
const { createPractice, getPractice, reanalyzeSession, cancelPractice } = await import("../src/lib/api/v2/practices.ts");
const { uploadLibraryVideo } = await import("../src/lib/api/v2/videos.ts");
const { startConversation, replyConversation } = await import("../src/lib/api/v2/coach-conversations.ts");
const { getPracticeNote } = await import("../src/lib/api/v2/notes.ts");
const { getMemory, saveMemoryField } = await import("../src/lib/api/v2/memory.ts");
const { claimExitSurvey, submitPracticeFeedback } = await import("../src/lib/api/v2/practice-feedback.ts");
const { practiceToSessionDetail } = await import("../src/features/practice/practice-view.ts");
const { nextTakeCopy } = await import("../src/features/practice/practice-note.ts");

// 실제 요청과 응답을 현재 서버 스냅샷에 대조한다. mock 경로가 서버에서 사라져도 초록이 되는 일을 막는다.
function conforms(value, schema) {
  if (schema.$ref) return conforms(value, spec.components.schemas[schema.$ref.split("/").at(-1)]);
  if (schema.anyOf) {
    assert.ok(schema.anyOf.some((candidate) => { try { conforms(value, candidate); return true; } catch { return false; } }), "응답이 계약의 어느 형식에도 맞지 않음");
    return;
  }
  if (schema.const !== undefined) assert.equal(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === "null") { assert.equal(value, null); return; }
  if (schema.type === "object") {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `필수 필드 ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) conforms(child, schema.properties[key]);
      else if (schema.additionalProperties === false) assert.fail(`계약에 없는 필드 ${key}`);
    }
  } else if (schema.type === "array") {
    assert.ok(Array.isArray(value));
    value.forEach((item) => conforms(item, schema.items));
  } else if (schema.type === "integer") assert.ok(Number.isInteger(value));
  else if (schema.type) assert.equal(typeof value, schema.type);
}

test("현재 OpenAPI 경로로 영상·회차·코치·노트·기억·설문 HTTP 왕복이 이어진다", async () => {
  const practiceId = "00000000-0000-4000-8000-000000000001";
  const requestId = "00000000-0000-4000-8000-000000000002";
  const videoId = "00000000-0000-4000-8000-000000000003";
  const created = "2026-09-21T03:00:00Z";
  const video = { id: videoId, content_type: "video/mp4", duration_ms: 1234, byte_size: 5, favorite: false,
    created_at: created, usage: { practice_count: 1, entry_count: 0 }, playback_url: "https://video.test/play", purged_at: null };
  const practice = { id: practiceId, root_id: practiceId, ordinal: 1, video_id: videoId, stage: "conversing",
    experience_version: "three_layers_v1", situation: "면접", character: "", goal: "", blockage_category: "그 외",
    blockage_detail: "그 외", conversation_count: 1, previous_conversations: [], created_at: created,
    analysis_status: "partial", job: { id: requestId, status: "succeeded", attempt_count: 1 } };
  const conversation = { id: requestId, status: "open", revision: 1, coach_reply_count: 1, reply_limit: 10,
    messages: [{ turn_index: 1, role: "coach", text: "무엇을 보셨나요?" }] };
  const note = { id: requestId, conversation_id: requestId, format: "v2", kind: "action", title: "말끝",
    summary_quotes: [{ quote: "붙잡고 싶어요", kind: "actor", source_ref: "actor-1" }],
    actor_words: ["붙잡고 싶어요"], corrections: [], tags: [], fallback: false, source_revision: 2,
    next_take: "배우가 말한 방향", report: publicNote, created_at: created };
  const memory = { field: "goal", value: "내 목표", written_by_actor: true, source_practice_id: null, updated_at: created };
  const calls = [];
  const failures = [];
  let origin;
  const routes = {
    "POST /v2/videos/intents": [201, () => ({ intent_id: requestId, upload_url: `${origin}/object`, expires_at: created })],
    [`POST /v2/videos/intents/${requestId}/complete`]: [201, () => video],
    [`GET /v2/videos/${videoId}`]: [200, () => video],
    "POST /v2/practices": [201, () => practice],
    [`GET /v2/practices/${practiceId}/analysis`]: [200, () => ({ id: requestId, format: "video_record_v1", status: "partial", summary: { schema_version: "acttub.video_record_summary.v1", record_id: requestId, record_version: 1, duration_ms: 1234, status: "partial", processed_ranges: [], missing_ranges: [], observed_scene: ["시선이 내려갔다"], spoken_content: [], limitations: [] } })],
    [`GET /v2/practices/${practiceId}`]: [200, () => practice],
    [`POST /v2/practices/${practiceId}/analyze`]: [201, () => practice],
    [`POST /v2/practices/${practiceId}/cancel`]: [200, () => ({ stage: "closed", close_reason: "cancelled", job: { id: requestId, status: "failed", failure_reason: "cancelled", attempt_count: 1 } })],
    "POST /v2/coach/start": [200, () => ({ conversation, message: "무엇을 보셨나요?" })],
    "POST /v2/coach/reply": [200, () => ({ conversation: { ...conversation, status: "closed", close_reason: "actor_finished", revision: 2 }, message: "오늘은 여기까지예요", note })],
    [`GET /v2/practices/${practiceId}/note`]: [200, () => note],
    "GET /v2/me/memory": [200, () => ({ items: [memory] })],
    "PUT /v2/me/memory/goal": [200, () => memory],
    "POST /v2/me/practice-feedback/claim": [200, () => ({ asked: true, asked_now: true })],
    "POST /v2/practice-feedback": [201, () => ({ id: requestId })],
  };
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (req.url === "/object") {
        assert.equal(req.method, "PUT"); assert.equal(req.headers["content-type"], "video/mp4");
        assert.equal(bytes.toString(), "video"); res.writeHead(200).end(); return;
      }
      const route = `${req.method} ${req.url}`;
      calls.push(route);
      const template = Object.keys(spec.paths).find((path) => new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(req.url));
      const operation = spec.paths[template]?.[req.method.toLowerCase()];
      assert.ok(operation, `현재 서버에 없는 경로 ${route}`);
      assert.ok(routes[route], `예상하지 못한 HTTP 요청 ${route}`);
      if (operation.requestBody) {
        const body = JSON.parse(bytes.toString());
        conforms(body, operation.requestBody.content["application/json"].schema);
        if (body.request_id) assert.equal(req.headers["x-request-id"], body.request_id);
      }
      const [status, response] = routes[route];
      const body = response();
      const media = operation.responses[String(status)].content;
      conforms(body, (media["application/json"] ?? media["*/*"]).schema);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    } catch (error) {
      failures.push(error.message);
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ detail: "contract_failure" }));
    }
  });
  const originalFetch = globalThis.fetch;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, init) => originalFetch(new URL(url, origin), init);
    const uploaded = await uploadLibraryVideo(new File(["video"], "take.mp4", { type: "video/mp4" }), {
      requestId, durationMs: 1234,
      uploader: async ({ url, file, contentType }) => { const response = await originalFetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } }); assert.equal(response.status, 200); },
    });
    const started = await createPractice({ video_id: uploaded.id, scene: { situation: "면접" } }, { requestId });
    assert.equal(started.practice.video_id, videoId);
    const detail = practiceToSessionDetail(await getPractice(practiceId));
    assert.equal(detail.status, "analyzed"); assert.deepEqual(detail.summary.observed_scene, ["시선이 내려갔다"]); assert.equal(detail.playback_url, video.playback_url);
    assert.equal((await reanalyzeSession(practiceId, { requestId })).id, practiceId);
    assert.equal((await cancelPractice(practiceId)).job.failure_reason, "cancelled");
    const opened = await startConversation(practiceId, { requestId });
    assert.equal(opened.conversation.messages[0].text, "무엇을 보셨나요?");
    const closed = await replyConversation({ conversationId: requestId, revision: 1, text: "그만" }, { requestId });
    assert.equal(closed.conversation.status, "closed");
    assert.equal(nextTakeCopy(await getPracticeNote(practiceId)), publicNote.practice.instruction);
    assert.equal((await getMemory()).items[0].written_by_actor, true);
    assert.equal((await saveMemoryField("goal", "내 목표")).value, "내 목표");
    assert.equal(await claimExitSurvey(), true);
    assert.equal((await submitPracticeFeedback({ practiceId, screen: "coach", trigger: "x", body: "좋았어요" }, { requestId })).id, requestId);
    assert.equal(calls.length, 15);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(failures, []);
  }
});
