// reading.session — 완료 화면(D19)과 회차 카드가 보여 주는 말. 껍데기(Page)는 next/link 를 끌어와 Node 에서
// 그릴 수 없으므로 본문만 정적으로 그려 문구를 본다. 점수·등급·칭찬 문구가 없어야 한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { DoneBody, REVIEW_HEADING } = await import("../src/features/reading/screens/DoneBody.tsx");
const { elapsedLabel, resumeProgress, sessionCardLine, sessionDateLabel } = await import("../src/features/reading/session-cards.ts");

const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레플레프"],
  characters: [
    { id: "c-a", name: "니나", voicePreset: null },
    { id: "c-b", name: "트레플레프", voicePreset: null },
  ],
  lines: [
    { type: "direction", text: "밤." },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "dialogue", role: "트레플레프", text: "둘." },
    { type: "dialogue", role: "니나", text: "셋." },
    { type: "dialogue", role: "트레플레프", text: "넷." },
    { type: "dialogue", role: "니나", text: "다섯." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3", "l-4", "l-5"],
  raw: "",
  openSessionId: null,
  lastSession: null,
};

const noop = () => {};
const render = (stats) =>
  renderToStaticMarkup(React.createElement(DoneBody, { script, stats, repeating: false, error: null, onRepeat: noop, onChangeSetup: noop, onNewScript: noop, onDetail: noop }));
const text = (html) => html.replace(/<[^>]+>/g, "");

test("reading.session: 완료 화면에는 내 배역·읽은 대사·걸린 시간이 있고 점수·등급·칭찬 문구가 없다", () => {
  const t = text(render({ mode: "read", elapsedMs: 125_000, lineCount: 5, myCharacterNames: ["니나"], lineResults: [] }));
  assert.equal(t.includes("니나"), true);
  assert.equal(t.includes("5줄"), true);
  assert.equal(t.includes("02:05"), true);
  for (const banned of ["정확도", "%", "잘했어요", "훌륭"]) assert.equal(t.includes(banned), false, banned);
});

test("reading.session: 다시 볼 대사에는 원문과 대사 번호만 있고 unmatched·skipped 가 없으면 절이 없다", () => {
  const withReview = text(
    render({
      mode: "read",
      elapsedMs: 1_000,
      lineCount: 5,
      myCharacterNames: ["니나"],
      lineResults: [
        { line_id: "l-1", outcome: "passed", misses: 0 },
        { line_id: "l-3", outcome: "unmatched", misses: 1 },
        { line_id: "l-5", outcome: "skipped", misses: 0 },
      ],
    }),
  );
  assert.equal(withReview.includes(REVIEW_HEADING(2)), true);
  assert.equal(withReview.includes("3번셋."), true);
  assert.equal(withReview.includes("5번다섯."), true);
  assert.equal(withReview.includes("하나."), false);

  const none = text(render({ mode: "read", elapsedMs: 1_000, lineCount: 5, myCharacterNames: ["니나"], lineResults: [{ line_id: "l-1", outcome: "passed", misses: 0 }] }));
  assert.equal(none.includes("암기 필요"), false);
});

test("reading.session: quiz 완료는 \"맞춘 줄 K / 시도 N · 아직 안 나온 줄 P\" 를 보여 주고 대사 정확도 % 는 없다", () => {
  const t = text(
    render({
      mode: "quiz",
      elapsedMs: 1_000,
      lineCount: 5,
      myCharacterNames: ["니나"],
      lineResults: [
        { line_id: "l-1", outcome: "passed", misses: 1 },
        { line_id: "l-3", outcome: "unmatched", misses: 2 },
        { line_id: "l-5", outcome: "skipped", misses: 0 },
      ],
    }),
  );
  assert.equal(t.includes("맞춘 줄 1 / 시도 2 · 아직 안 나온 줄 1"), true);
  assert.equal(t.includes("정확도"), false);
  assert.equal(t.includes("다시 대조"), true);
});

test("reading.session: 완료 화면의 코치 카드는 촬영 준비로 잇고 리딩 자료는 보내지 않는다고 말한다", () => {
  const html = render({ mode: "read", elapsedMs: 1_000, lineCount: 5, myCharacterNames: ["니나"], lineResults: [] });
  assert.match(html, /href="\/practice\/new"/);
  assert.equal(text(html).includes("리딩 자료는 보내지 않아요"), true);
});

test("reading.session: 회차 카드는 회차 번호·상태·내 배역·녹음 진행·걸린 시간을 보여 주고, 열린 회차의 \"이어서 연습 · K / N\" 은 지난 대사 수다", () => {
  const card = { id: "s-1", ordinal: 2, status: "completed", my_character_ids: ["c-a"], my_character_names: ["니나"], range: { start_dialogue_no: 1, end_dialogue_no: 5 }, my_dialogue_count: 3, recorded_line_count: 2, elapsed_seconds: 65, started_at: "2026-09-21T03:00:00+09:00", ended_at: null };
  assert.equal(sessionCardLine(card), "2회차 · 완료 · 니나 · 내 대사 3개 중 2개 녹음 · 01:05");
  assert.equal(sessionCardLine({ ...card, status: "in_progress", my_character_names: [] }), "2회차 · 진행 중 · 배역 미선택 · 내 대사 3개 중 2개 녹음 · 01:05");
  assert.equal(elapsedLabel(0), "00:00");
  assert.equal(sessionDateLabel("2026-05-25T12:00:00+09:00", "Asia/Seoul"), "5월 25일");
  // 13번 대사를 지나 다음이 l-3(대사 3) 이면 지난 대사는 2
  assert.deepEqual(resumeProgress(script, { start_line_id: "l-1", end_line_id: "l-5", current_line_id: "l-3" }), { done: 2, total: 5 });
  assert.deepEqual(resumeProgress(script, { start_line_id: "l-1", end_line_id: "l-5", current_line_id: "l-1" }), { done: 0, total: 5 });
  assert.deepEqual(resumeProgress(script, { start_line_id: "l-1", end_line_id: "l-5", current_line_id: null }), { done: 0, total: 5 });
});
