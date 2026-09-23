import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { startConversation, getConversation } = await import("../src/lib/api/v2/coach-conversations.ts");
const { conversationLines, actorTurnCount, isConversationDone } = await import("../src/features/practice/conversation-view.ts");
const { getPractice, getPracticeStatus } = await import("../src/lib/api/v2/practices.ts");
const { practiceToSessionDetail } = await import("../src/features/practice/practice-view.ts");
const { sessionStatusOf } = await import("../src/features/practice/practice-analysis.ts");
const { getPracticeNote } = await import("../src/lib/api/v2/notes.ts");
const { PracticeReportCards } = await import("../src/features/practice/practice-report-cards.tsx");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

// ConversationDtos.ConversationResponse / TurnResultResponse 의 실제 HTTP 응답 모양.
test("서버 messages와 close_reason으로 재개하고 conversation.status로 종료한다", async () => {
  const conversation = {
    id: "c1", practice_id: "p1", status: "closed", close_reason: "actor_finished",
    revision: 3, coach_reply_count: 2, reply_limit: 10,
    messages: [
      { turn_index: 1, role: "coach", text: "무엇을 봤나요?", created_at: null },
      { turn_index: 2, role: "actor", text: "말끝이 달랐어요", created_at: null },
      { turn_index: 3, role: "coach", text: "오늘은 여기까지예요", created_at: null },
    ], created_at: null,
  };
  globalThis.fetch = async (url, init) => {
    if (url === "/v2/coach/start") {
      assert.deepEqual(JSON.parse(init.body), { practice_id: "p1", request_id: "r1" });
      return json({ conversation, message: "오늘은 여기까지예요", note: null });
    }
    assert.equal(url, "/v2/coach/conversations/c1");
    return json(conversation);
  };
  const turn = await startConversation("p1", { requestId: "r1" });
  assert.equal(isConversationDone(turn), true);
  const history = await getConversation("c1");
  assert.deepEqual(conversationLines(history), [
    { role: "ai", text: "무엇을 봤나요?" }, { role: "me", text: "말끝이 달랐어요" },
    { role: "ai", text: "오늘은 여기까지예요" },
  ]);
  assert.equal(actorTurnCount(history), 1);
  assert.equal(history.close_reason, "actor_finished");
});

test("노트 봉투의 quote/kind/source_ref와 공개 report의 제안을 실제 화면에 보인다", async () => {
  const publicNote = JSON.parse(readFileSync(new URL("./fixtures/practice-note.json", import.meta.url)));
  const note = { id: "n1", conversation_id: "c1", format: "v2", kind: "action", title: "말끝",
    summary_quotes: [{ quote: "붙잡고 싶었어요", kind: "actor", source_ref: "actor-2" },
      { quote: "시선이 내려갔다", kind: "observation", source_ref: "video-1" }],
    next_take: "말끝을 짧게 끝내기", actor_words: ["놓치고 싶지 않아요"], corrections: [], tags: [],
    fallback: false, source_revision: 3, report: publicNote, created_at: "2026-09-21T03:00:00Z" };
  globalThis.fetch = async (url) => { assert.equal(url, "/v2/practices/p1/note"); return json(note); };
  const loaded = await getPracticeNote("p1");
  const html = renderToStaticMarkup(createElement(PracticeReportCards, { report: loaded }));
  assert.match(html, /붙잡고 싶었어요/);
  assert.match(html, /내가 한 말/);
  assert.match(html, /영상에서 본 것/);
  assert.match(html, /오늘 촬영도 수고했어요/);
  assert.ok(html.indexOf("붙잡고 싶었어요") < html.indexOf(publicNote.practice.instruction));
  assert.doesNotMatch(html, /actor-2|video-1/);
});

test("평평한 회차 응답과 영상 상세를 조합하고 partial 분석을 대화 가능한 상태로 읽는다", async () => {
  const practice = {
    id: "p1", root_id: "p1", ordinal: 1, video_id: "v1", stage: "conversing",
    close_reason: null, experience_version: "three_layers_v1", situation: "면접", character: "지원자",
    goal: "이야기 잇기", blockage_category: "그 외", blockage_detail: "그 외", blockage_note: null,
    created_at: "2026-09-21T03:00:00Z", analysis_status: "partial", conversation_id: null,
    conversation_status: null, conversation_count: 0, note_id: null, note_title: null, note_kind: null,
    job: { id: "j1", status: "succeeded", failure_reason: null, attempt_count: 1 }, previous_conversations: [],
  };
  globalThis.fetch = async (url) => {
    if (url === "/v2/practices/p1") return json(practice);
    if (url === "/v2/practices/p1/status") return json({ stage: "conversing", analysis_status: "partial", job: practice.job });
    if (url === "/v2/practices/p1/analysis") return new Response(null, { status: 404 });
    assert.equal(url, "/v2/videos/v1");
    return json({ id: "v1", duration_ms: 4000, byte_size: 12, content_type: "video/mp4", favorite: false,
      created_at: practice.created_at, usage: { practice_count: 1, entry_count: 0 },
      playback_url: "https://video.test/signed", playback_expires_at: null, purged_at: null });
  };
  const detail = practiceToSessionDetail(await getPractice("p1"));
  assert.equal(detail.situation, "면접");
  assert.equal(detail.character_context, "지원자");
  assert.equal(detail.video_id, "v1");
  assert.equal(detail.playback_url, "https://video.test/signed");
  assert.equal(detail.video_purged, false);
  assert.equal(detail.analysis_status, "partial");
  assert.equal(detail.status, "analyzed");
  assert.equal(sessionStatusOf(await getPracticeStatus("p1")), "analyzed");
});

test("기존 갈래 노트 봉투 안의 공개 원문을 그대로 렌더한다", async () => {
  const report = { report_type: "analysis", title: "기다리는 장면", actor_discovery: "상대를 기다리고 있었어요",
    line_meaning: "붙잡는 말", timing_reason: "떠나려는 순간", target_effect: "앉게 하기",
    next_take: { direction: "문장을 짧게 끊어보기", tested: false }, acting_caution: "서두르지 않기",
    evidence: ["마지막 대사"], uncertainties: [], source_handoff_id: "h1" };
  const note = { id: "n1", conversation_id: "c1", format: "legacy", kind: "analysis", title: report.title,
    summary_quotes: [], next_take: null, actor_words: [], corrections: [], tags: [], fallback: false,
    source_revision: 3, report, created_at: "2026-09-21T03:00:00Z" };
  globalThis.fetch = async () => json(note);
  const html = renderToStaticMarkup(createElement(PracticeReportCards, { report: await getPracticeNote("p1") }));
  assert.match(html, /상대를 기다리고 있었어요/);
  assert.match(html, /문장을 짧게 끊어보기/);
  assert.match(html, /아직 해보지 않은 제안/);
});

test("분석 조회의 공개 영상 기록을 장면 패널에 전달하고 준비 전에는 조회하지 않는다", async () => {
  const summary = { schema_version: "acttub.video_record_summary.v1", record_id: "a1", record_version: 1,
    duration_ms: 5000, status: "partial", processed_ranges: [{ start_ms: 0, end_ms: 3000 }],
    missing_ranges: [{ start_ms: 3000, end_ms: 5000 }], observed_scene: ["시선이 내려갔다"],
    spoken_content: ["가지 마"], limitations: [] };
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url === "/v2/practices/p1") return json({ id: "p1", root_id: "p1", ordinal: 1, video_id: null,
      stage: "conversing", analysis_status: "partial", situation: "", character: "", goal: "",
      blockage_category: "그 외", blockage_detail: "그 외", created_at: "2026-09-21T00:00:00Z" });
    assert.equal(url, "/v2/practices/p1/analysis");
    return json({ id: "a1", format: "video_record_v1", status: "partial", summary });
  };
  const detail = practiceToSessionDetail(await getPractice("p1"));
  assert.deepEqual(detail.summary, summary);
  assert.deepEqual(calls, ["/v2/practices/p1", "/v2/practices/p1/analysis"]);
  calls.length = 0;
  globalThis.fetch = async (url) => { calls.push(url); return json({ id: "p2", stage: "analyzing", video_id: null, analysis_status: null }); };
  await getPractice("p2");
  assert.deepEqual(calls, ["/v2/practices/p2"]);
});
