// reading.session — 완료 화면(D19)과 회차 카드가 보여 주는 말. 껍데기(Page)는 next/link 를 끌어와 Node 에서
// 그릴 수 없으므로 본문만 정적으로 그려 문구를 본다. 점수·등급·칭찬 문구가 없어야 한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { DIFFERENT_LATER_COPY, DoneBody, REVIEW_HEADING } = await import("../src/features/reading/screens/DoneBody.tsx");
const { sessionDateLabel } = await import("../src/features/reading/session-cards.ts");

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
  lastSession: null,
};

const noop = () => {};
const render = (stats) =>
  renderToStaticMarkup(React.createElement(DoneBody, { script, stats, repeating: false, error: null, onRepeat: noop, onChangeSetup: noop, onNewScript: noop, onDetail: noop }));
const text = (html) => html.replace(/<[^>]+>/g, "");

test("reading.session: 완료 화면에는 내 배역·읽은 대사·걸린 시간이 있고 점수·등급·칭찬 문구가 없다", () => {
  const t = text(render({ mode: "read", elapsedMs: 125_000, lineCount: 5, myCharacterNames: ["니나"], lineResults: [], differentLines: [] }));
  assert.equal(t.includes("니나"), true);
  assert.equal(t.includes("5줄"), true);
  assert.equal(t.includes("02:05"), true);
  for (const banned of ["정확도", "%", "잘했어요", "훌륭"]) assert.equal(t.includes(banned), false, banned);
});

const read = { mode: "read", elapsedMs: 1_000, lineCount: 5, myCharacterNames: ["니나"], lineResults: [] };
const differentLine = (lineId, dialogueNo, said, words) => ({ line_id: lineId, dialogue_no: dialogueNo, said, different_words: words });

test("reading.session: read 완료의 다시 볼 대사는 서버 different_lines 의 대사 번호와 원문이고, 없으면 절이 없다", () => {
  const withReview = text(
    render({
      ...read,
      differentLines: [
        differentLine("l-3", 3, "섯", [{ text: "셋.", differs: true }]),
        differentLine("l-5", 5, null, [{ text: "다섯.", differs: false }]),
      ],
    }),
  );
  assert.equal(withReview.includes(REVIEW_HEADING(2)), true);
  assert.equal(withReview.includes("3번셋."), true);
  assert.equal(withReview.includes("5번다섯."), true);
  assert.equal(withReview.includes("하나."), false);
  assert.equal(withReview.includes(DIFFERENT_LATER_COPY), false);

  const none = text(render({ ...read, differentLines: [] }));
  assert.equal(none.includes("암기 필요"), false);
  assert.equal(none.includes(DIFFERENT_LATER_COPY), false);
});

test("reading.session: read 완료 응답을 받지 못했으면 다시 볼 대사 자리에 안내 한 줄만 있다", () => {
  const t = text(render({ ...read, differentLines: null }));
  assert.equal(t.includes("연결되면 비교 결과를 보여 드릴게요"), true);
  assert.equal(t.includes("암기 필요"), false);
  assert.equal(t.includes("리딩을 마쳤어요"), true);
  assert.equal(t.includes("촬영 준비로"), true);
});

test("reading.session: quiz 완료의 다시 볼 대사는 기기가 정한 unmatched·skipped 줄이다", () => {
  const t = text(
    render({
      mode: "quiz",
      elapsedMs: 1_000,
      lineCount: 5,
      myCharacterNames: ["니나"],
      lineResults: [
        { line_id: "l-1", outcome: "passed", misses: 0 },
        { line_id: "l-3", outcome: "unmatched", misses: 2 },
        { line_id: "l-5", outcome: "skipped", misses: 0 },
      ],
      differentLines: null,
    }),
  );
  assert.equal(t.includes(REVIEW_HEADING(2)), true);
  assert.equal(t.includes("3번셋."), true);
  assert.equal(t.includes("5번다섯."), true);
  assert.equal(t.includes(DIFFERENT_LATER_COPY), false);
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
  const html = render({ ...read, differentLines: [] });
  assert.match(html, /href="\/practice\/new"/);
  assert.equal(text(html).includes("리딩 자료는 보내지 않아요"), true);
});

test("reading.session: 회차 카드의 날짜는 한국 날짜로 보인다", () => {
  assert.equal(sessionDateLabel("2026-05-25T12:00:00+09:00", "Asia/Seoul"), "5월 25일");
});
