// practice.note — 신형 노트의 규칙과 화면. 제목은 초점 원문이고 순서는 요약 → 다음 촬영 → 응원이다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { PracticeReportCards } = await import("../src/features/practice/practice-report-cards.tsx");
const {
  FALLBACK_NOTICE,
  isNoteV2,
  noteQuotes,
  noteTitle,
  NO_NEXT_TAKE_COPY,
  quoteSourceLabel,
} = await import("../src/features/practice/practice-note.ts");
const { getPracticeNote } = await import("../src/lib/api/v2/notes.ts");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function note(overrides = {}) {
  return {
    id: "n-1",
    format: "v2",
    kind: "action",
    title: "말끝이 흐려지는 순간",
    summary_quotes: [
      { quote: "붙잡고 싶었어요", kind: "actor", source_ref: "actor-1" },
      { quote: "마지막 문장에서 시선이 내려갔다", kind: "observation", source_ref: "video-1" },
    ],
    next_take: "말끝을 짧게 끊고 한 번 더 찍어 보기",
    actor_words: ["붙잡고 싶었어요"],
    corrections: [],
    tags: ["말끝"],
    fallback: false,
    report: { cheer: "오늘 촬영도 수고했어요." },
    source_revision: 9,
    created_at: "2026-09-21T03:00:00Z",
    ...overrides,
  };
}

const html = (report) => renderToStaticMarkup(createElement(PracticeReportCards, { report }));

test("practice.note: 제목은 초점 원문이고 초점이 없는 record_only 는 묶음 대체 제목을 쓴다", () => {
  assert.equal(noteTitle(note(), "면접 첫 인사"), "말끝이 흐려지는 순간");
  const recordOnly = note({ kind: "record_only", title: null, next_take: null, summary_quotes: [] });
  assert.equal(noteTitle(recordOnly, "면접 첫 인사"), "면접 첫 인사");
  // 상황 문장도 없으면 묶음과 같은 말을 쓴다.
  assert.equal(noteTitle(recordOnly, ""), "제목 없는 연습");
  // 고정 제목("연습 노트")은 없앴다.
  assert.doesNotMatch(html(note()), /연습 노트<\/h2>/);
});

test("practice.note: 화면 순서는 요약 → 다음 촬영에서 해볼 한 가지 → 응원이다", () => {
  const markup = html(note());
  const summaryAt = markup.indexOf("붙잡고 싶었어요");
  const takeAt = markup.indexOf("말끝을 짧게 끊고");
  const cheerAt = markup.indexOf("오늘 촬영도 수고했어요.");
  assert.ok(summaryAt !== -1 && takeAt > summaryAt, "요약이 다음 촬영보다 먼저다");
  assert.ok(cheerAt > takeAt, "응원이 마지막이다");
  // 비교 기준·확인 강제 카피는 기본 화면에서 뺀다.
  assert.doesNotMatch(markup, /비교|분석 확정|배우님과 맞춘/);
});

test("practice.note: 요약 인용은 최대 둘이고 각 인용에 출처가 붙는다", () => {
  const many = note({
    summary_quotes: [
      { quote: "하나", kind: "actor", source_ref: "actor-1" },
      { quote: "둘", kind: "observation", source_ref: "video-1" },
      { quote: "셋", kind: "actor", source_ref: "actor-1" },
    ],
  });
  assert.deepEqual(noteQuotes(many).map((q) => q.quote), ["하나", "둘"]);
  assert.equal(quoteSourceLabel("actor"), "내가 한 말");
  assert.equal(quoteSourceLabel("observation"), "영상에서 본 것");

  const markup = html(many);
  assert.match(markup, /내가 한 말/);
  assert.match(markup, /영상에서 본 것/);
  assert.equal(markup.includes("셋"), false);
});

test("practice.note: 종류마다 다음 촬영 자리가 다르다 — 제안이 없으면 없다고 말한다", () => {
  assert.match(html(note()), /말끝을 짧게 끊고/);

  const observation = note({ kind: "observation", next_take: null });
  const markup = html(observation);
  assert.match(markup, new RegExp(NO_NEXT_TAKE_COPY));
  // 근거 없는 촬영 과제를 지어내지 않는다.
  assert.doesNotMatch(markup, /해볼 것을 정했어요/);

  const recordOnly = note({ kind: "record_only", title: null, next_take: null, summary_quotes: [] });
  assert.match(html(recordOnly), /오늘 나눈 것만 남겼어요/);
});

test("practice.note: 폴백 노트는 확인된 것만 담았다고 밝힌다", () => {
  assert.equal(FALLBACK_NOTICE, "대화에서 확인한 것만 남겼어요");
  assert.match(html(note({ fallback: true })), new RegExp(FALLBACK_NOTICE));
  assert.doesNotMatch(html(note()), new RegExp(FALLBACK_NOTICE));
});

test("practice.note: 옛 노트도 그대로 그린다 — 신형인지는 필드로 가른다", () => {
  assert.equal(isNoteV2(note()), true);
  assert.equal(isNoteV2({ report_type: "practice_note", title: "옛 노트", summary: "요약", mode: "action" }), false);
  assert.equal(isNoteV2(null), false);
});

test("practice.note: 노트는 회차 경로로 읽는다", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(note()), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const loaded = await getPracticeNote("practice-1");

  assert.deepEqual(calls, ["/v2/practices/practice-1/note"]);
  assert.equal(loaded?.kind, "action");
});

test("practice.note: 노트가 없는 회차는 null 이다 — 화면은 빈 자리를 그린다", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });

  assert.equal(await getPracticeNote("practice-1"), null);
});
